import { MemoryRecordings } from "./memory-recordings.js";
import { PcmRecorder } from "./pcm-recorder.js";

export class BrowserRecordings extends MemoryRecordings {
    constructor({ devices, getConfiguration, onFailure }) {
        super({ uploadOptions: () => {
            const { config, credentials, url } = getConfiguration();
            return { baseUrl: url, headers: { authorization: "Bearer " + credentials.reconnectToken }, chunkBytes: config.recordings.chunkBytes, timeoutMs: config.recordings.uploadTimeoutMs };
        } });
        this.devices = devices;this.getConfiguration = getConfiguration;this.onFailure = onFailure;this.finalizations = new Map();
    }
    async start(streams, { scope }) {
        if (this.active) throw new Error("Another browser recording is active");
        const { config } = this.getConfiguration();this.maxBytes = config.recordings.maxBytesPerParticipant;
        const recorder = new PcmRecorder({ context: this.devices.context, maxBytes: this.maxBytes - this.byteLength(), maxConditionSeconds: config.recordings.maxConditionSeconds, onFailure: this.onFailure });
        this.active = { recorder, scope };
        try {await recorder.start(streams);}
        catch (error) {this.active = null;throw error;}
    }
    finalize({ scope, status }) {
        if (this.finalizations.has(scope.attemptId)) return this.finalizations.get(scope.attemptId);
        if (!this.active) return Promise.resolve(null);
        if (["sessionId", "participantId", "attemptId"].some(key => this.active.scope[key] !== scope[key])) return Promise.reject(new Error("Recording finalization scope mismatch"));
        const { recorder } = this.active;
        const result = (async () => {
            const files = await recorder.stop();
            const incomplete = recorder.failure || (files && Object.values(files).some(file => file.size <= 44));
            const manifests = files ? await this.retain({ scope, files, status: incomplete ? "interrupted" : status }) : null;
            this.active = null;return manifests;
        })();
        this.finalizations.set(scope.attemptId, result);return result;
    }
    async dispose() {if (this.active) await this.finalize({ scope: this.active.scope, status: "interrupted" });}
}
