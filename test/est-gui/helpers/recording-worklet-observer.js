// Test-only registration wrapper: delegate all PCM processing to the real class.
const nativeRegisterProcessor = globalThis.registerProcessor;
globalThis.registerProcessor = (name, Processor) => {
    if (name !== 'est-record') return nativeRegisterProcessor.call(globalThis, name, Processor);
    class ObservedRecorder extends Processor {
        constructor(...args) {
            super(...args);
            this.testStats = {workletRate: sampleRate, inputFrames: 0, renderFrames: 0, inputBlockLengths: {}, renderQuantumLengths: {}};
            this.testInput = new Float32Array(96000);this.testOffset = 0;
            const handler = this.port.onmessage;
            this.port.onmessage = event => {
                if (event.data.type === 'stop') {
                    const pcm = this.testInput.slice(0, this.testOffset);
                    this.port.postMessage({type: 'test-worklet-input', pcm, workletRate: sampleRate}, [pcm.buffer]);
                    this.port.postMessage({type: 'test-worklet-stats', stats: this.testStats});
                }
                handler(event);
            };
        }
        process(inputs, outputs, parameters) {
            if (this.active) {
                const input = inputs[0]?.[0]?.length || 0, output = outputs[0]?.[0]?.length || 0;
                this.testStats.inputFrames += input;this.testStats.renderFrames += output;
                this.testStats.inputBlockLengths[input] = (this.testStats.inputBlockLengths[input] || 0) + 1;
                this.testStats.renderQuantumLengths[output] = (this.testStats.renderQuantumLengths[output] || 0) + 1;
                const channels = inputs[0];
                for (let n = 0; n < input && this.testOffset < this.testInput.length; n++) {
                    let value = 0;for (const channel of channels) value += channel[n];
                    this.testInput[this.testOffset++] = value / channels.length;
                }
            }
            return super.process(inputs, outputs, parameters);
        }
    }
    return nativeRegisterProcessor.call(globalThis, name, ObservedRecorder);
};
