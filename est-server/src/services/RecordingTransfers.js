const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { identifier, validateManifest } = require("@effectstreamer/common");

async function syncDirectory(directory) {
    // Windows does not expose POSIX directory fsync through Node.
    if (process.platform === "win32") return;
    const handle = await fs.promises.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJson(destination, value) {
    const temporary = destination + ".tmp-" + randomUUID();
    try {
        const file = await fs.promises.open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(value) + "\n"); await file.sync(); }
        finally { await file.close(); }
        await fs.promises.rename(temporary, destination);
        await syncDirectory(path.dirname(destination));
    }
    catch (error) { await fs.promises.rm(temporary, { force: true }).catch(() => {}); throw error; }
}
async function byteLength(file) {
    try { return (await fs.promises.stat(file)).size; }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
}
async function validateWav(file, manifest) {
    const handle = await fs.promises.open(file, "r");
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
    }
    finally { await handle.close(); }
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== manifest.sha256) throw new Error("Recording digest mismatch");
}

class RecordingTransfers {
    constructor({ root, getSession, config, now = Date.now, onReceipt = async () => {} }) {
        this.root = path.join(path.resolve(root), ".uploads");
        fs.mkdirSync(this.root, { recursive: true });
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
    partPath(id) { return path.join(this.root, id + ".part"); }

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

    destination(session, manifest) {
        return path.join(session.sessionDir, "attempts", manifest.attemptId, manifest.participantId, manifest.filename);
    }

    async register(participant, manifests) {
        if (!Array.isArray(manifests) || !manifests.length || manifests.length > 2) throw new Error("Announce one or both WAV tracks");
        const result = [];
        for (const supplied of manifests) {
            const manifest = structuredClone(validateManifest(supplied));
            result.push(await this.locked(manifest.recordingId, async () => {
                const record = { manifest, expiresAt: this.now() + this.config.uploadTimeoutMs };
                const { session, attempt } = this.authorize(participant, record);
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
                    await atomicJson(this.metadataPath(manifest.recordingId), record);
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
            const offset = record.receipt ? record.manifest.byteLength : (await byteLength(this.partPath(supplied.recordingId)) || await byteLength(destination));
            if (offset > record.manifest.byteLength) throw new Error("Invalid stored upload length");
            return { uploadId: supplied.recordingId, nextByteOffset: offset };
        });
    }

    append(participant, id, offset, data) {
        return this.locked(id, async () => {
            const record = await this.load(id); this.authorize(participant, record);
            if (!Buffer.isBuffer(data) || !data.length || data.length > this.config.chunkBytes || !Number.isSafeInteger(offset) || offset < 0 || offset + data.length > record.manifest.byteLength) throw new Error("Invalid recording chunk");
            const filePath = this.partPath(id), size = await byteLength(filePath);
            if (record.receipt) return { nextByteOffset: record.manifest.byteLength };
            if (offset > size || (offset < size && offset + data.length > size)) throw new Error("Unexpected chunk offset");
            const file = await fs.promises.open(filePath, size ? "r+" : "w+", 0o600);
            try {
                if (offset < size) {
                    const old = Buffer.alloc(data.length);
                    const read = await file.read(old, 0, old.length, offset);
                    if (read.bytesRead !== old.length || !old.equals(data)) throw new Error("Conflicting duplicate recording chunk");
                }
                else {
                    let written = 0;
                    while (written < data.length) {
                        const result = await file.write(data, written, data.length - written, offset + written);
                        if (!result.bytesWritten) throw new Error("Recording write made no progress");
                        written += result.bytesWritten;
                    }
                    await file.sync();
                }
            }
            finally { await file.close(); }
            return { nextByteOffset: Math.max(size, offset + data.length) };
        });
    }

    commit(participant, id) {
        return this.locked(id, async () => {
            const record = await this.load(id), { session } = this.authorize(participant, record);
            if (record.receipt) { await this.onReceipt(session, record.manifest, record.receipt); return record.receipt; }
            const destination = this.destination(session, record.manifest), temporary = this.partPath(id);
            // A crash after publish but before receipt persistence reconciles the already stored WAV.
            const published = (await byteLength(destination)) > 0;
            await validateWav(published ? destination : temporary, record.manifest);
            if (!published) {
                await fs.promises.mkdir(path.dirname(destination), { recursive: true });
                await fs.promises.rename(temporary, destination);
            }
            await syncDirectory(path.dirname(destination));
            record.receipt = { recordingId: id, sha256: record.manifest.sha256, stored: true };
            await atomicJson(this.metadataPath(id), record);
            await this.onReceipt(session, record.manifest, record.receipt);
            return record.receipt;
        });
    }
}
module.exports = { RecordingTransfers, validateWav };
