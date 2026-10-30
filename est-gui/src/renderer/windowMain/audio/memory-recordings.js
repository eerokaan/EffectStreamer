import { uploadRecording } from "../../../shared/recording-transfer.js";

export class MemoryRecordings {
    constructor({ maxBytes = 134217728, uploadOptions = () => ({}) } = {}) {
        this.maxBytes = maxBytes;this.uploadOptions = uploadOptions;this.pending = new Map();this.receipts = new Map();
    }
    byteLength() {return [...this.pending.values()].reduce((total, entry) => total + entry.file.size, 0);}
    async retain({ scope, files, status }) {
        if (Object.keys(files).sort().join(",") !== "headphones,microphone") throw new Error("Both WAV recordings are required");
        const total = files.microphone.size + files.headphones.size;
        if (this.byteLength() + total > this.maxBytes) throw new Error("Pending browser recordings exceed memory limit");
        const entries = [];
        for (const track of ["microphone", "headphones"]) {
            const file = files[track];
            const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
            const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
            const manifest = { recordingId: crypto.randomUUID(), ...scope, track, filename: track + ".wav", source: "browser-memory", contentType: "audio/wav", byteLength: file.size, sha256, status };
            entries.push({ manifest, file });
        }
        for (const entry of entries) this.pending.set(entry.manifest.recordingId, entry);
        return entries.map(entry => entry.manifest);
    }
    async readChunk(id, offset, length) {
        const entry = this.pending.get(id);if (!entry) throw new Error("Unknown retained browser recording");
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || offset + length > entry.file.size) throw new Error("Invalid recording chunk range");
        return new Uint8Array(await entry.file.slice(offset, offset + length).arrayBuffer());
    }
    release(receipt) {
        const entry = this.pending.get(receipt.recordingId);
        if (!entry || receipt.stored !== true || receipt.sha256 !== entry.manifest.sha256) throw new Error("Invalid browser recording receipt");
        this.pending.delete(receipt.recordingId);this.receipts.set(receipt.recordingId, { receipt, manifest: entry.manifest });
    }
    async collect(command, options = {}) {
        for (const id of command.recordingIds) {
            const entry = this.pending.get(id) || this.receipts.get(id);
            if (!entry || ["sessionId", "participantId", "attemptId"].some(key => entry.manifest[key] !== command[key])) throw new Error("Unknown recording request owner/attempt");
            if (this.receipts.has(id)) continue;
            await uploadRecording({ ...this.uploadOptions(), ...options, manifest: entry.manifest, readChunk: (...args) => this.readChunk(...args), onReceipt: receipt => this.release(receipt) });
        }
    }
}
