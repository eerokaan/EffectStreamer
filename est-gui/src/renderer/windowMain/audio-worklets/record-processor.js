class RecordProcessor extends AudioWorkletProcessor {
    constructor() {
        super();this.buffer = new Float32Array(2048);this.offset = 0;this.active = true;
        this.port.onmessage = ({ data }) => {
            if (data.type === "stop") {this.active = false;this.flush();this.port.postMessage({ type: "stopped" });}
        };
    }
    flush() {
        if (!this.offset) return;
        const pcm = this.offset === this.buffer.length ? this.buffer : this.buffer.slice(0, this.offset);
        this.port.postMessage({ type: "pcm", pcm }, [pcm.buffer]);this.buffer = new Float32Array(2048);this.offset = 0;
    }
    process(inputs, outputs) {
        for (const output of outputs) for (const channel of output) channel.fill(0);
        if (!this.active) return true;
        const channels = inputs[0];if (!channels?.length) return true;
        for (let index = 0; index < channels[0].length; index++) {
            let value = 0;for (const channel of channels) value += channel[index];
            this.buffer[this.offset++] = value / channels.length;
            if (this.offset === this.buffer.length) this.flush();
        }
        return true;
    }
}
registerProcessor("est-record", RecordProcessor);
