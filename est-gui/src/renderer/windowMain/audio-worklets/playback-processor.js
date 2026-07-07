const blockFrames = 128;
const ringFrames = 2048;
const targetFrames = blockFrames * 2;
const pcmPoolSize = 8;
const maxCorrectionPpm = 500;
const controllerPpmPerFrame = 4;
const statsIntervalFrames = 48000;
const statsSampleCapacity = 512;

class EffectStreamerPlaybackProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.mediaPort = null;
        this.ring = new Float32Array(ringFrames);
        this.writeFrame = 0;
        this.readFrame = 0;
        this.running = false;
        this.hasRun = false;
        this.needsResync = false;
        this.expectedSequence = 0;
        this.framesSinceStats = 0;
        this.occupancySamples = new Float32Array(statsSampleCapacity);
        this.correctionSamples = new Float32Array(statsSampleCapacity);
        this.statsSampleCount = 0;
        this.initialPoolMessages = new Array(pcmPoolSize);
        for (let index = 0; index < pcmPoolSize; index++) {
            this.initialPoolMessages[index] = { type: "recycle", samples: new Float32Array(blockFrames) };
        }
        this.recycleMessage = { type: "recycle", samples: null };
        this.stats = {
            blocksReceived: 0,
            underrunEvents: 0,
            underrunFrames: 0,
            overrunEvents: 0,
            overrunFrames: 0,
            hardResyncs: 0,
            sequenceGaps: 0
        };
        this.statsMessage = {
            type: "stats",
            final: false,
            stats: this.stats,
            occupancySamples: this.occupancySamples,
            correctionSamples: this.correctionSamples,
            sampleCount: 0
        };
        this.resyncMessage = { type: "hard-resync", reason: "", discardedFrames: 0, occupancyFrames: 0, hardResyncs: 0 };
        this.failureMessage = { type: "failure", message: "Playback media-port message error" };
        this.port.onmessage = (event) => this.handleNodeMessage(event.data);
    }

    handleNodeMessage(data) {
        if (data?.type === "attach" && data.port && !this.mediaPort) {
            this.mediaPort = data.port;
            this.mediaPort.onmessage = (event) => this.handleMediaMessage(event.data);
            this.mediaPort.onmessageerror = () => this.port.postMessage(this.failureMessage);
            this.mediaPort.start();
            for (let index = 0; index < pcmPoolSize; index++) {
                const message = this.initialPoolMessages[index];
                this.mediaPort.postMessage(message, [message.samples.buffer]);
                message.samples = null;
            }
            this.mediaPort.postMessage({ type: "ready" });
        }
        else if (data?.type === "shutdown") {
            this.sendStats(true);
            this.mediaPort?.close();
        }
    }

    handleMediaMessage(data) {
        if (data?.type === "audio") {
            this.admitAudio(data);
        }
        else if (data?.type === "final-stats") {
            this.sendStats(true);
        }
    }

    admitAudio(data) {
        const samples = data.samples;
        if (!(samples instanceof Float32Array) || samples.length !== blockFrames || !Number.isInteger(data.sequence)) return;

        if (data.sequence !== this.expectedSequence) {
            this.stats.sequenceGaps += Math.max(1, data.sequence - this.expectedSequence);
        }
        this.expectedSequence = data.sequence + 1;

        const occupancy = this.occupancy();
        let overflowDiscardedFrames = null;
        if (occupancy + samples.length > ringFrames) {
            const nextReadFrame = this.writeFrame + samples.length - targetFrames;
            const discardedFrames = Math.max(0, Math.floor(nextReadFrame) - Math.floor(this.readFrame));
            this.stats.overrunEvents++;
            this.stats.overrunFrames += discardedFrames;
            this.readFrame = nextReadFrame;
            this.running = false;
            overflowDiscardedFrames = discardedFrames;
        }

        for (let index = 0; index < samples.length; index++) {
            this.ring[(this.writeFrame + index) % ringFrames] = samples[index];
        }
        this.writeFrame += samples.length;
        if (overflowDiscardedFrames != null) this.emitHardResync("overflow", overflowDiscardedFrames);
        this.stats.blocksReceived++;
        this.recycleMessage.samples = samples;
        this.mediaPort.postMessage(this.recycleMessage, [samples.buffer]);
        this.recycleMessage.samples = null;
    }

    occupancy() {
        return Math.max(0, this.writeFrame - this.readFrame);
    }

    sampleAt(frame) {
        const oldestFrame = Math.max(0, this.writeFrame - ringFrames);
        const clampedFrame = Math.max(oldestFrame, Math.min(this.writeFrame - 1, frame));
        return this.ring[((clampedFrame % ringFrames) + ringFrames) % ringFrames];
    }

    cubicSample(position) {
        const frame = Math.floor(position);
        const fraction = position - frame;
        const p0 = this.sampleAt(frame - 1);
        const p1 = this.sampleAt(frame);
        const p2 = this.sampleAt(frame + 1);
        const p3 = this.sampleAt(frame + 2);
        const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
        const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
        const c = -0.5 * p0 + 0.5 * p2;
        return ((a * fraction + b) * fraction + c) * fraction + p1;
    }

    emitHardResync(reason, discardedFrames) {
        this.stats.hardResyncs++;
        this.resyncMessage.reason = reason;
        this.resyncMessage.discardedFrames = discardedFrames;
        this.resyncMessage.occupancyFrames = this.occupancy();
        this.resyncMessage.hardResyncs = this.stats.hardResyncs;
        this.mediaPort?.postMessage(this.resyncMessage);
    }

    sendStats(final = false) {
        if (!this.mediaPort) return;
        this.statsMessage.final = final;
        this.statsMessage.sampleCount = this.statsSampleCount;
        this.mediaPort.postMessage(this.statsMessage);
        this.framesSinceStats = 0;
        this.statsSampleCount = 0;
    }

    process(_inputs, outputs) {
        const output = outputs[0]?.[0];
        if (!output) return true;
        output.fill(0);

        const occupancy = this.occupancy();
        if (!this.running) {
            if (occupancy >= targetFrames) {
                if (this.needsResync) {
                    const nextReadFrame = this.writeFrame - targetFrames;
                    const discardedFrames = Math.max(0, Math.floor(nextReadFrame) - Math.floor(this.readFrame));
                    this.readFrame = nextReadFrame;
                    this.needsResync = false;
                    this.emitHardResync("starvation", discardedFrames);
                }
                this.running = true;
                this.hasRun = true;
            }
            else {
                this.recordControllerStats(occupancy, 0);
                return true;
            }
        }

        const errorFrames = this.occupancy() - targetFrames;
        const correctionPpm = Math.max(-maxCorrectionPpm, Math.min(maxCorrectionPpm, errorFrames * controllerPpmPerFrame));
        const ratio = 1 + correctionPpm / 1000000;
        const lastNeededFrame = this.readFrame + ratio * (output.length - 1) + 2;

        if (lastNeededFrame >= this.writeFrame) {
            if (this.hasRun) {
                this.stats.underrunEvents++;
                this.stats.underrunFrames += output.length;
                this.needsResync = true;
            }
            this.running = false;
            this.recordControllerStats(this.occupancy(), correctionPpm);
            return true;
        }

        if (correctionPpm === 0 && Number.isInteger(this.readFrame)) {
            for (let index = 0; index < output.length; index++) output[index] = this.sampleAt(this.readFrame + index);
            this.readFrame += output.length;
        }
        else {
            let position = this.readFrame;
            for (let index = 0; index < output.length; index++) {
                output[index] = this.cubicSample(position);
                position += ratio;
            }
            this.readFrame = position;
        }

        this.recordControllerStats(this.occupancy(), correctionPpm);
        return true;
    }

    recordControllerStats(occupancy, correctionPpm) {
        if (this.statsSampleCount < statsSampleCapacity) {
            this.occupancySamples[this.statsSampleCount] = occupancy;
            this.correctionSamples[this.statsSampleCount] = correctionPpm;
            this.statsSampleCount++;
        }
        this.framesSinceStats += blockFrames;
        if (this.framesSinceStats >= statsIntervalFrames) this.sendStats();
    }
}

registerProcessor("effectstreamer-playback", EffectStreamerPlaybackProcessor);
