const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { writeFileDirect } = require("@effectstreamer/common/direct-write");
const { identifier, validateManifest } = require("@effectstreamer/common");

async function syncDirectory(directory) {
    // Windows does not expose POSIX directory fsync through Node.
    if (process.platform === "win32") return;
    const handle = await fs.promises.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
}
async function writeJson(destination, value) {
    await writeFileDirect(destination, JSON.stringify(value) + "\n", { flush: true });
    await syncDirectory(path.dirname(destination));
}
async function byteLength(file) {
    try {
        const stat=await fs.promises.lstat(file);
        if(!stat.isFile() || stat.nlink !== 1) throw new Error('Recording path must be a regular non-linked file');
        return stat.size;
    }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
}
async function openRecording(file, readOnly = false) {
    try {await byteLength(file);} catch(error) {if(error.code!=='ENOENT')throw error;}
    const flags=(readOnly ? fs.constants.O_RDONLY : fs.constants.O_RDWR | fs.constants.O_CREAT) | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    const handle=await fs.promises.open(file,flags,0o600);
    try {
        const stat=await handle.stat();
        if(!stat.isFile() || stat.nlink !== 1) throw new Error('Recording path must be a regular non-linked file');
        if(!readOnly)await handle.chmod(0o600);
        return handle;
    } catch(error) {await handle.close();throw error;}
}
async function writeBytes(file, bytes, offset) {
    let written=0;
    while(written<bytes.length) {
        const result=await file.write(bytes,written,bytes.length-written,offset+written);
        if(!result.bytesWritten)throw new Error('Recording write made no progress');
        written+=result.bytesWritten;
    }
}
async function validateWav(file, manifest) {
    const handle = await openRecording(file, true);
    async function read(size, position) {
        const bytes = Buffer.alloc(size);
        const result = await handle.read(bytes, 0, size, position);
        if (result.bytesRead !== size) throw new Error("Incomplete WAV header");
        return bytes;
    }
    try {
        const length = (await handle.stat()).size;
        if (length !== manifest.byteLength) throw new Error("Incomplete recording byte length");
        const header = await read(12, 0);
        if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) !== length - 8) throw new Error("Invalid RIFF/WAV container");
        let offset = 12, format = false, audio = false;
        while (offset + 8 <= length) {
            const chunk = await read(8, offset), name = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4);
            if (offset + 8 + size > length) throw new Error("Invalid WAV chunk length");
            if (name === "fmt ") {
                if (size < 16 || format) throw new Error("Invalid WAV format chunk");
                const fmt = await read(16, offset + 8);
                if (fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(2) !== 1 || fmt.readUInt32LE(4) !== 48000 || fmt.readUInt32LE(8) !== 96000 || fmt.readUInt16LE(12) !== 2 || fmt.readUInt16LE(14) !== 16) throw new Error("WAV must contain mono 48 kHz S16LE PCM");
                format = true;
            }
            if (name === "data") {
                if (audio || size % 2 || (!size && manifest.status === "complete")) throw new Error("Invalid WAV audio data");
                audio = true;
            }
            offset += 8 + size + (size % 2);
        }
        if (!format || !audio || offset !== length) throw new Error("Missing or malformed WAV chunks");
        const hash=createHash('sha256'),buffer=Buffer.alloc(1048576);
        for(let position=0;position<length;) {
            const count=Math.min(buffer.length,length-position),result=await handle.read(buffer,0,count,position);
            if(result.bytesRead!==count)throw new Error('Incomplete recording byte length');
            hash.update(buffer.subarray(0,count));position+=count;
        }
        if(hash.digest('hex')!==manifest.sha256)throw new Error('Recording digest mismatch');
    }
    finally { await handle.close(); }
}

class RecordingTransfers {
    constructor({ root, getSession, config, now = Date.now, onReceipt = async () => {} }) {
        this.resultsRoot=path.resolve(root);fs.mkdirSync(this.resultsRoot,{recursive:true});
        this.realRoot=fs.realpathSync(this.resultsRoot);this.root=path.join(this.realRoot,'.uploads');
        try {fs.mkdirSync(this.root,{mode:0o700});} catch(error) {if(error.code!=='EEXIST')throw error;}
        const stat=fs.lstatSync(this.root);
        if(!stat.isDirectory() || stat.isSymbolicLink())throw new Error('Unsafe upload metadata directory symlink');
        this.getSession = getSession; this.config = config; this.now = now; this.onReceipt = onReceipt;
        this.pending = new Map();
    }

    locked(id, operation) {
        try { identifier(id, "recordingId"); } catch (error) { return Promise.reject(error); }
        const result = (this.pending.get(id) || Promise.resolve()).catch(() => {}).then(operation);
        this.pending.set(id, result);
        void result.finally(() => { if (this.pending.get(id) === result) this.pending.delete(id); }).catch(() => {});
        return result;
    }

    metadataPath(id) { return path.join(this.root, id + ".json"); }

    async load(id) {
        try { return JSON.parse(await fs.promises.readFile(this.metadataPath(id), "utf8")); }
        catch (error) { if (error.code === "ENOENT") throw new Error("Recording has not been announced/registered"); throw error; }
    }

    authorize(participant, record) {
        const manifest = validateManifest(record.manifest);
        const session = this.getSession(participant.participantId);
        if (manifest.participantId !== participant.participantId || !session || session.sessionId !== manifest.sessionId || !session.clientsData.has(participant.participantId)) throw new Error("Recording participant/owner mismatch");
        const attempt = session.attempts.find(attempt => attempt.attemptId === manifest.attemptId);
        if (!attempt) throw new Error("Unknown recording attempt");
        if (!record.receipt && this.now() > record.expiresAt) throw new Error("Recording upload deadline expired");
        return { session, attempt };
    }

    destination(session, manifest, create = false) {
        const relative=path.relative(this.resultsRoot,path.resolve(session.sessionDir));
        if(path.isAbsolute(relative) || relative==='..' || relative.startsWith('..'+path.sep))throw new Error('Session directory is not confined to its results root');
        let current=this.realRoot;
        const parts=[...relative.split(path.sep).filter(Boolean),'attempts',manifest.attemptId,manifest.participantId];
        for(const part of parts) {
            current=path.join(current,part);
            if(create)try{fs.mkdirSync(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
            let stat;try{stat=fs.lstatSync(current);}catch(error){if(!create && error.code==='ENOENT')continue;throw error;}
            if(!stat.isDirectory() || stat.isSymbolicLink())throw new Error('Recording directory contains an unsafe symlink or non-directory');
        }
        return path.join(current,manifest.filename);
    }

    async register(participant, manifests) {
        if (!Array.isArray(manifests) || !manifests.length || manifests.length > 2) throw new Error("Announce one or both WAV tracks");
        const result = [];
        for (const supplied of manifests) {
            const manifest = structuredClone(validateManifest(supplied));
            result.push(await this.locked(manifest.recordingId, async () => {
                const record = { manifest, expiresAt: this.now() + this.config.uploadTimeoutMs };
                const { session, attempt } = this.authorize(participant, record);
                record.expiresAt = Math.min(record.expiresAt, attempt.uploadDeadline || record.expiresAt);
                if (!["stopping", "uploading", "interrupted", "completed"].includes(attempt.status)) throw new Error("Attempt is not ready for recording transfer");
                const expected = attempt.recordings || [];
                const existing = expected.find(item => item.participantId === manifest.participantId && item.track === manifest.track);
                if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error("Recording track is already registered with different data");
                const total = expected.filter(item => item.participantId === manifest.participantId && item.track !== manifest.track).reduce((sum, item) => sum + item.byteLength, manifest.byteLength);
                if (total > this.config.maxBytesPerParticipant) throw new Error("Recording byte limit exceeded");
                try {
                    const saved = await this.load(manifest.recordingId);
                    if (JSON.stringify(saved.manifest) !== JSON.stringify(manifest)) throw new Error("Recording ID already registered with different data");
                    this.authorize(participant, saved);
                }
                catch (error) {
                    if (!error.message.includes("not been announced")) throw error;
                    await writeJson(this.metadataPath(manifest.recordingId), record);
                }
                if (!existing) attempt.recordings = [...expected, manifest];
                await session.persist();
                return manifest;
            }));
        }
        return result;
    }

    begin(participant, supplied) {
        return this.locked(supplied?.recordingId, async () => {
            const record = await this.load(supplied.recordingId);
            const { session } = this.authorize(participant, record);
            if (JSON.stringify(validateManifest(supplied)) !== JSON.stringify(record.manifest)) throw new Error("Recording manifest mismatch");
            const destination = this.destination(session, record.manifest);
            const offset = record.receipt ? record.manifest.byteLength : await byteLength(destination);
            if (offset > record.manifest.byteLength) throw new Error("Invalid stored upload length");
            return { uploadId: supplied.recordingId, nextByteOffset: offset };
        });
    }

    append(participant, id, offset, data) {
        return this.locked(id, async () => {
            const record = await this.load(id); const {session}=this.authorize(participant, record);
            if (!Buffer.isBuffer(data) || !data.length || data.length > this.config.chunkBytes || !Number.isSafeInteger(offset) || offset < 0 || offset + data.length > record.manifest.byteLength) throw new Error("Invalid recording chunk");
            if (record.receipt) return { nextByteOffset: record.manifest.byteLength };
            const filePath = this.destination(session,record.manifest), size = await byteLength(filePath);
            if (offset > size || (offset < size && offset + data.length > size)) throw new Error("Unexpected chunk offset");
            this.destination(session,record.manifest,true);
            const file = await openRecording(filePath);
            try {
                if (offset < size) {
                    const old = Buffer.alloc(data.length);
                    const read = await file.read(old, 0, old.length, offset);
                    if (read.bytesRead !== old.length || !old.equals(data)) throw new Error("Conflicting duplicate recording chunk");
                }
                else {
                    await writeBytes(file,data,offset);
                    await file.sync();
                }
            }
            finally { await file.close(); }
            return { nextByteOffset: Math.max(size, offset + data.length) };
        });
    }

    async commit(participant, id) {
        const { session, manifest, receipt } = await this.locked(id, async () => {
            const record = await this.load(id), { session } = this.authorize(participant, record);
            if (record.receipt) return { session, manifest: record.manifest, receipt: record.receipt };
            const destination = this.destination(session, record.manifest);
            await validateWav(destination, record.manifest);
            await syncDirectory(path.dirname(destination));
            record.receipt = { recordingId: id, sha256: record.manifest.sha256, stored: true };
            await writeJson(this.metadataPath(id), record);
            return { session, manifest: record.manifest, receipt: record.receipt };
        });
        // Session actions can register manifests under this recording lock.
        // Release it before joining the session queue, including receipt retries.
        // Still await reconciliation before acknowledging the client.
        await this.onReceipt(session, manifest, receipt);
        return receipt;
    }
}
module.exports = { RecordingTransfers, validateWav };
