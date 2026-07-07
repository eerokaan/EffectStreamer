const blockFrames = 128;
const pcmPoolSize = 4;
const statsIntervalFrames = 48000;

class EffectStreamerCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.mediaPort = null;
        this.sequence = 0;
        this.framesSinceStats = 0;
        this.frozen = false;
        this.availableEnvelopes = new Array(pcmPoolSize);
        this.availableCount = 0;
        this.freeEnvelopes = new Array(pcmPoolSize);
        this.freeCount = pcmPoolSize;
        for (let index = 0; index < pcmPoolSize; index++) {
            this.freeEnvelopes[index] = { type: "audio", sequence: 0, samples: null };
        }
        this.stats = {
            blocksCaptured: 0,
            creditStarvedFrames: 0
        };
        this.statsMessage = { type: "stats", final: false, stats: this.stats };
        this.failureMessage = { type: "failure", message: "Capture media-port message error" };
        this.port.onmessage = (event) => this.handleNodeMessage(event.data);
    }

    handleNodeMessage(data) {
        if (data?.type === "attach" && data.port && !this.mediaPort) {
            this.mediaPort = data.port;
            this.mediaPort.onmessage = (event) => this.handleMediaMessage(event.data);
            this.mediaPort.onmessageerror = () => this.port.postMessage(this.failureMessage);
            this.mediaPort.start();
            this.mediaPort.postMessage({ type: "ready" });
        }
        else if (data?.type === "shutdown") {
            this.frozen = true;
            this.sendStats(true);
            this.mediaPort?.close();
        }
    }

    handleMediaMessage(data) {
        if (data?.type === "recycle" && data.samples instanceof Float32Array && data.samples.length === blockFrames && this.availableCount < pcmPoolSize && this.freeCount > 0) {
            const envelope = this.freeEnvelopes[--this.freeCount];
            envelope.samples = data.samples;
            this.availableEnvelopes[this.availableCount++] = envelope;
        }
        else if (data?.type === "freeze") {
            this.frozen = true;
            this.sendStats(true);
        }
        else if (data?.type === "final-stats") {
            this.sendStats(true);
        }
    }

    sendStats(final = false) {
        if (!this.mediaPort) return;
        this.statsMessage.final = final;
        this.mediaPort.postMessage(this.statsMessage);
        this.framesSinceStats = 0;
    }

    process(inputs, outputs) {
        const output = outputs[0]?.[0];
        if (output) output.fill(0);
        if (this.frozen) return true;

        const input = inputs[0]?.[0];
        if (!input || input.length !== blockFrames) return true;

        const sequence = this.sequence++;
        this.stats.blocksCaptured++;
        this.framesSinceStats += input.length;

        if (this.mediaPort && this.availableCount > 0) {
            const envelope = this.availableEnvelopes[--this.availableCount];
            const samples = envelope.samples;
            samples.set(input);
            envelope.sequence = sequence;
            this.mediaPort.postMessage(envelope, [samples.buffer]);
            envelope.samples = null;
            this.freeEnvelopes[this.freeCount++] = envelope;
        }
        else {
            this.stats.creditStarvedFrames += input.length;
        }

        if (this.framesSinceStats >= statsIntervalFrames) this.sendStats();
        return true;
    }
}

registerProcessor("effectstreamer-capture", EffectStreamerCaptureProcessor);
