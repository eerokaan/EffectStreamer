// Browser-side diagnostic support only. No production imports or behavior changes.
export function createRecordingTap(NativeNode, {maxFrames = 96000} = {}) {
    const records = [];
    return {
        Node: class {
            constructor(context, ...args) {
                const node = new NativeNode(context, ...args);
                const record = {track: ['microphone', 'headphones'][records.length], rate: context.sampleRate, totalFrames: 0, samples: []};
                records.push(record);
                // Registered before PcmRecorder's onmessage: copy before its transfer.
                node.port.addEventListener('message', ({data}) => {
                    if (data.type === 'test-worklet-input') {record.inputSamples = Array.from(data.pcm.subarray(0, maxFrames));record.inputWorkletRate = data.workletRate;return;}
                    if (data.type === 'test-worklet-stats') {record.workletStats = data.stats;return;}
                    if (data.type !== 'pcm') return;
                    record.totalFrames += data.pcm.length;
                    const remaining = Math.max(0, maxFrames - record.samples.length);
                    record.samples.push(...data.pcm.subarray(0, remaining));
                });
                return node;
            }
        },
        snapshot: () => records.map(record => ({...record, samples: [...record.samples]}))
    };
}

const loaded = new WeakMap();
export async function captureProbe(context, source, {Node = globalThis.AudioWorkletNode, timeoutMs = 10000} = {}) {
    if (!loaded.has(context)) loaded.set(context, context.audioWorklet.addModule('/media-test-probe.js'));
    await loaded.get(context);
    const node = new Node(context, 'est-test-audio-probe', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {frames: Math.round(context.sampleRate * 1.5)}});
    let timer;
    const began = performance.now();
    try {
        const pending = new Promise((resolve, reject) => {
            node.port.onmessage = ({data}) => resolve(data);
            node.onprocessorerror = () => reject(new Error('Audio probe processor failed'));
            timer = setTimeout(() => reject(new Error('Audio probe timed out')), timeoutMs);
        });
        source.connect(node);node.connect(context.destination);
        const {pcm, ...metadata} = await pending;
        return {...metadata, contextRate: context.sampleRate, wallElapsedMs: performance.now() - began, samples: Array.from(pcm)};
    } finally {clearTimeout(timer);source.disconnect(node);node.disconnect();node.port.close();}
}
