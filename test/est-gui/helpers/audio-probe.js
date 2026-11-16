class AudioProbe extends AudioWorkletProcessor {
    constructor({processorOptions: {frames}}) {
        super();this.pcm = new Float32Array(frames);this.position = 0;
        this.inputFrames = 0;this.absentInputFrames = 0;this.firstFrame = null;this.done = false;
    }
    process(inputs, outputs) {
        for (const output of outputs) for (const channel of output) channel.fill(0);
        if (this.done) return true;
        const channels = inputs[0], count = Math.min(outputs[0]?.[0]?.length || 128, this.pcm.length - this.position);
        this.firstFrame ??= currentFrame;
        if (channels?.length) {
            this.inputFrames += count;
            for (let n = 0; n < count; n++) {
                let value = 0;for (const channel of channels) value += channel[n];
                this.pcm[this.position + n] = value / channels.length;
            }
        } else this.absentInputFrames += count;
        this.position += count;
        if (this.position === this.pcm.length) {
            this.done = true;
            this.port.postMessage({pcm: this.pcm, workletRate: sampleRate, inputFrames: this.inputFrames,
                absentInputFrames: this.absentInputFrames, firstFrame: this.firstFrame, endFrame: currentFrame + count}, [this.pcm.buffer]);
        }
        return true;
    }
}
registerProcessor('est-test-audio-probe', AudioProbe);
