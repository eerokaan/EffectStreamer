import recordWorkletUrl from "../audio-worklets/record-processor.js?url&no-inline";
import WavWorker from "./wav-worker.js?worker";

export class PcmRecorder {
    constructor({ context, maxBytes, maxConditionSeconds = 600, Worker = WavWorker, AudioWorkletNode = globalThis.AudioWorkletNode, onFailure = () => {} }) {
        this.context = context;this.maxBytes = maxBytes;this.maxConditionSeconds = maxConditionSeconds;this.Worker = Worker;this.Node = AudioWorkletNode;this.onFailure = onFailure;
        this.pending = new Map();this.nodes = [];this.sequence = 0;
    }
    fail(error) {if (!this.failure) {this.failure = error;this.onFailure(error);}}
    request(type, payload = {}) {
        const id = String(++this.sequence);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {this.pending.delete(id);reject(new Error("PCM worker timed out"));}, 10000);
            this.pending.set(id, { resolve, reject, timer });this.worker.postMessage({ id, type, ...payload });
        });
    }
    async start({ microphone, playback }) {
        if (this.context?.sampleRate !== 48000) throw new Error("Recording requires a verified 48000 Hz AudioContext");
        if (!microphone?.getAudioTracks?.().length || !playback?.getAudioTracks?.().length) throw new Error("Both microphone and playback streams/tracks are required");
        if (this.worker || this.starting) throw new Error("A PCM recording is already active");
        const token = {};this.token = token;this.starting = true;
        const check = () => {if (this.token !== token) throw new Error("PCM recording start cancelled");};
        this.failure = null;this.stopPromise = null;
        try {
            await this.context.resume();
            check();
            if (this.context.state === "suspended") throw new Error("AudioContext activation was blocked; repeat setup with a user gesture");
            this.worker = new this.Worker();
            this.worker.onmessage = ({ data }) => {
                const request = this.pending.get(data.id);
                if (request) {this.pending.delete(data.id);clearTimeout(request.timer);data.type === "failure" ? request.reject(new Error(data.message)) : request.resolve(data.files);}
                if (data.type === "failure") this.fail(new Error(data.message));
            };
            this.worker.onerror = event => this.fail(new Error(event.message || "PCM recording worker failed"));
            await this.request("init", { maxBytes: this.maxBytes });
            check();
            await this.context.audioWorklet.addModule(recordWorkletUrl);
            check();
            for (const [track, stream] of [["microphone", microphone], ["headphones", playback]]) {
                const source = this.context.createMediaStreamSource(stream), node = new this.Node(this.context, "est-record", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
                const entry = { source, node };this.nodes.push(entry);
                node.onprocessorerror = () => this.fail(new Error("PCM recording processor failed"));
                node.port.onmessage = ({ data }) => {
                    if (data.type === "pcm" && this.worker) this.worker.postMessage({ type: "pcm", track, pcm: data.pcm }, [data.pcm.buffer]);
                    if (data.type === "stopped") entry.stopped?.();
                };
                source.connect(node);node.connect(this.context.destination); // Worklet output is always silence.
            }
            this.deadline = setTimeout(() => this.fail(new Error("Maximum condition duration exceeded")), this.maxConditionSeconds * 1000);
        }
        catch (error) {this.cleanup();throw error;}
        finally {this.starting = false;}
    }
    stop() {
        this.token = null;
        if (!this.worker) return Promise.resolve(null);
        this.stopPromise ||= (async () => {
            clearTimeout(this.deadline);
            try {
                await Promise.all(this.nodes.map(entry => new Promise(resolve => {
                    const timer = setTimeout(() => {this.fail(new Error("Recording processor flush timed out"));resolve();}, 2000);
                    entry.stopped = () => {clearTimeout(timer);resolve();};entry.node.port.postMessage({ type: "stop" });
                })));
                return await this.request("finish");
            }
            finally {this.cleanup();}
        })();
        return this.stopPromise;
    }
    cleanup() {
        clearTimeout(this.deadline);
        for (const { source, node } of this.nodes) {source.disconnect();node.disconnect();node.port.close();}this.nodes = [];
        this.worker?.terminate();this.worker = null;
        for (const request of this.pending.values()) {clearTimeout(request.timer);request.reject(new Error("PCM recording stopped"));}this.pending.clear();
    }
}
