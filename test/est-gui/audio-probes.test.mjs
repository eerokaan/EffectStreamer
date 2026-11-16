import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { createRecordingTap, captureProbe } from './helpers/browser-audio-probes.mjs';

it('copies real PCM before the recorder transfers it, with bounded retention and full frame counts', async () => {
    const channels = [];
    class Node {
        constructor() {const channel = new MessageChannel();channels.push(channel);this.port = channel.port1;}
    }
    try {
        const tap = createRecordingTap(Node, {maxFrames: 3});
        const node = new tap.Node({sampleRate: 48000}, 'est-record');
        for (const values of [[.25, .5, .75, 1], [-.25, -.5]]) {
            const received = new Promise(resolve => {node.port.onmessage = ({data}) => {structuredClone(data.pcm, {transfer: [data.pcm.buffer]});resolve();};});
            const pcm = new Float32Array(values);channels[0].port2.postMessage({type: 'pcm', pcm}, [pcm.buffer]);await received;
        }
        const stats = {workletRate: 48000, inputFrames: 6, renderFrames: 6};
        const observed = new Promise(resolve => {node.port.onmessage = resolve;});
        channels[0].port2.postMessage({type: 'test-worklet-stats', stats});await observed;
        const [capture] = tap.snapshot();
        expect(capture.track).toBe('microphone');expect(capture.rate).toBe(48000);
        expect(capture.totalFrames).toBe(6);expect(capture.samples).toEqual([.25, .5, .75]);
        expect(capture.workletStats).toEqual(stats);
    } finally {for (const channel of channels) {channel.port1.close();channel.port2.close();}}
});

async function processor(frames) {
    let Processor;const messages = [];
    class Base {constructor() {this.port = {postMessage: message => messages.push(message)};}}
    vm.runInNewContext(await fs.readFile(new URL('./helpers/audio-probe.js', import.meta.url), 'utf8'), {
        AudioWorkletProcessor: Base, registerProcessor: (_name, value) => {Processor = value;}, Float32Array,
        sampleRate: 48000, currentFrame: 0
    });
    return {node: new Processor({processorOptions: {frames}}), messages};
}
it('bounded probe distinguishes absent input from captured zero-valued input and silences outputs', async () => {
    const {node, messages} = await processor(200), out = new Float32Array(128).fill(1);
    node.process([[new Float32Array(128)]], [[out]]);expect([...out]).toEqual(Array(128).fill(0));
    node.process([[]], [[out]]);node.process([[]], [[out]]);
    expect(messages).toHaveLength(1);expect(messages[0].pcm.length).toBe(200);
    expect(messages[0].inputFrames).toBe(128);expect(messages[0].absentInputFrames).toBe(72);
    expect(messages[0].workletRate).toBe(48000);
});
it('probe downmix matches the production recording worklet channel average', async () => {
    const {node, messages} = await processor(128);
    node.process([[new Float32Array(128).fill(.25), new Float32Array(128).fill(.75)]], [[new Float32Array(128)]]);
    expect([...messages[0].pcm]).toEqual(Array(128).fill(.5));
});

function captureFixture(deliver) {
    const cleaned = [];
    class Node {
        constructor() {this.port = {close: () => cleaned.push('port')};}
        connect() {}
        disconnect() {cleaned.push('node');}
    }
    const context = {sampleRate: 48000, destination: {}, audioWorklet: {addModule: async () => {}}};
    const source = {connect: node => queueMicrotask(() => deliver?.(node)), disconnect: () => cleaned.push('source')};
    return {context, source, Node, cleaned};
}
it('probe capture returns bounded PCM and releases graph and port after success', async () => {
    const f = captureFixture(node => node.port.onmessage({data: {pcm: new Float32Array([.5]), workletRate: 48000, inputFrames: 1, absentInputFrames: 0}}));
    const result = await captureProbe(f.context, f.source, {Node: f.Node});
    expect(result.samples).toEqual([.5]);expect(result.contextRate).toBe(48000);
    expect(f.cleaned.sort()).toEqual(['node', 'port', 'source']);
});
it('probe capture times out and releases graph and port instead of leaving an active recorder', async () => {
    const f = captureFixture();
    await expect(captureProbe(f.context, f.source, {Node: f.Node, timeoutMs: 10})).rejects.toThrow(/timed out/);
    expect(f.cleaned.sort()).toEqual(['node', 'port', 'source']);
});
it('probe processor failure rejects and releases graph and port', async () => {
    const f = captureFixture(node => node.onprocessorerror());
    await expect(captureProbe(f.context, f.source, {Node: f.Node})).rejects.toThrow(/processor failed/);
    expect(f.cleaned.sort()).toEqual(['node', 'port', 'source']);
});

it('test-only worklet observer preserves the real processor PCM while measuring input versus output block lengths', async () => {
    const production = await fs.readFile(new URL('../../est-gui/src/renderer/windowMain/audio-worklets/record-processor.js', import.meta.url), 'utf8');
    const observer = await fs.readFile(new URL('./helpers/recording-worklet-observer.js', import.meta.url), 'utf8');
    function run(prefix) {
        let Processor;const messages = [];
        class Base {constructor() {this.port = {postMessage: message => messages.push(message)};}}
        const sandbox = vm.createContext({AudioWorkletProcessor: Base, registerProcessor: (_name, value) => {Processor = value;}, Float32Array, sampleRate: 48000, currentFrame: 0});
        if (prefix) vm.runInContext(prefix, sandbox);
        vm.runInContext(production, sandbox);
        const node = new Processor();node.process([[new Float32Array(139).fill(.5)]], [[new Float32Array(128)]]);node.port.onmessage({data: {type: 'stop'}});
        return messages;
    }
    const plain = run(''), observed = run(observer);
    expect([...observed.find(m => m.type === 'pcm').pcm]).toEqual([...plain.find(m => m.type === 'pcm').pcm]);
    const stats = observed.find(m => m.type === 'test-worklet-stats').stats;
    expect(stats.inputFrames).toBe(139);expect(stats.renderFrames).toBe(128);
    expect(stats.inputBlockLengths).toEqual({'139': 1});expect(stats.renderQuantumLengths).toEqual({'128': 1});
    expect(stats.workletRate).toBe(48000);
    const input = observed.find(m => m.type === 'test-worklet-input');
    expect([...input.pcm]).toEqual(Array(139).fill(.5));
    expect(input.workletRate).toBe(48000);
});
