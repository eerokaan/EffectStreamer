const tracks = ["microphone", "headphones"];
function header(length) {
    const bytes = new ArrayBuffer(44), view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    text(0, "RIFF");view.setUint32(4, 36 + length, true);text(8, "WAVEfmt ");view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);view.setUint16(22, 1, true);view.setUint32(24, 48000, true);view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true);view.setUint16(34, 16, true);text(36, "data");view.setUint32(40, length, true);return bytes;
}
export class WavAccumulator {
    constructor({ maxBytes }) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 88) throw new Error("Recording byte limit must hold two WAV headers");
        this.maxBytes = maxBytes;this.total = 88;this.tracks = new Map(tracks.map(track => [track, { chunks: [], length: 0 }]));
    }
    append(track, samples) {
        const recording = this.tracks.get(track);
        if (!recording || !(samples instanceof Float32Array)) throw new Error("Invalid PCM recording track/block");
        const length = samples.length * 2;
        if (this.total + length > this.maxBytes) throw new Error("Browser recording memory limit exceeded");
        const bytes = new ArrayBuffer(length), view = new DataView(bytes);
        for (let index = 0; index < samples.length; index++) {
            const value = Math.max(-1, Math.min(1, Number.isFinite(samples[index]) ? samples[index] : 0));
            view.setInt16(index * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
        }
        recording.chunks.push(bytes);recording.length += length;this.total += length;
    }
    finish() {return Object.fromEntries([...this.tracks].map(([track, { length, chunks }]) => [track, new Blob([header(length), ...chunks], { type: "audio/wav" })]));}
}
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
    let writer;
    self.onmessage = ({ data }) => {
        try {
            if (data.type === "init") writer = new WavAccumulator(data);
            else if (data.type === "pcm") {writer.append(data.track, data.pcm);return;}
            else if (data.type === "finish") {const files = writer.finish();writer = null;self.postMessage({ id: data.id, files });return;}
            else throw new Error("Unknown recording worker operation");
            self.postMessage({ id: data.id, ok: true });
        }
        catch (error) {self.postMessage({ id: data.id, type: "failure", message: error.message });}
    };
}
