import { expect } from "@playwright/test";
import { createServer } from "../tools.mjs";
import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeTone, decodePcmWav } from './audio-signal.mjs';
const require = createRequire(import.meta.url);
const {checkoutPaths}=require('../../../common/transient-paths.cjs');
const { createCoordinator } = require("../../../est-server/src/server.js");
const { normalizeConfig } = require("../../../est-server/src/bootstraps/configManager.js");
const { remoteConfig } = require("../../est-server/fixtures/config.js");

export async function withBrowserMedia({ browser, testInfo, diagnostics = process.env.EST_AUDIO_DIAGNOSTICS === '1' }, inspectEvidence = async () => {}) {
    if (diagnostics) testInfo.setTimeout(90000); // Bounded raw tracing adds overhead; normal acceptance stays at 60 s.
    const root = checkoutPaths().temporaryDirectory('est-gui','est-browser-media-');
    const config = normalizeConfig(remoteConfig());
    Object.assign(config.remote, { coreExecutable: process.env.EST_CORE_EXECUTABLE || checkoutPaths().path('est-core','build','linux','est-core'), internalPortRange: [35100, 35199], icePortRange: [47000, 47499], playbackDrainMs: 20, startupTimeoutMs: 20000 });
    const app = createCoordinator({ config, root });
    const vite = await createServer({ configFile: path.resolve("vite.web.config.mjs"), configLoader:'runner', server: { middlewareMode: true }, appType: "custom" });
    if (diagnostics) {
        app.app.get('/media-test-probe.js', (_request, response) => response.type('text/javascript').sendFile(path.join(import.meta.dirname, 'audio-probe.js')));
        app.app.get('/media-test-probes.mjs', (_request, response) => response.type('text/javascript').sendFile(path.join(import.meta.dirname, 'browser-audio-probes.mjs')));
        app.app.get('/media-test-record-observer.js', (_request, response) => response.type('text/javascript').sendFile(path.join(import.meta.dirname, 'recording-worklet-observer.js')));
    }
    app.app.use(vite.middlewares);
    app.app.get("/media-test", (_request, response) => response.type("html").send('<!doctype html><button id="prepare">Prepare audio</button>'));
    app.server.listen(0, "127.0.0.1");await once(app.server, "listening");
    const url = "http://127.0.0.1:" + app.server.address().port;
    const people = ["browser-a", "browser-b"].map(identity => app.enrollments.admit({ identity }));
    const session = app.registry.createPair(people.map(person => app.enrollments.get(person.participantId)));
    session.recordingContextActive = "browser-attempt";
    session.attempts.push({ attemptId: "browser-attempt", status: "preparing" });
    const context = await browser.newContext();const pages = await Promise.all(people.map(() => context.newPage()));
    try {
        await Promise.all(pages.map(async (page, index) => {
            await page.goto(url + "/media-test");
            await page.evaluate(async ({ credentials, index, url, diagnostics }) => {
                const { BrowserDevices } = await import("/src/renderer/windowMain/audio/browser-devices.js");
                const { BrowserAudioSession } = await import("/src/renderer/windowMain/audio/browser-session.js");
                const { createParticipantRuntime } = await import("/src/renderer/windowMain/runtime/create-runtime.js");
                const { PcmRecorder } = await import("/src/renderer/windowMain/audio/pcm-recorder.js");
                const { MemoryRecordings } = await import("/src/renderer/windowMain/audio/memory-recordings.js");
                window.errors = [];window.contexts = [];window.syntheticSources = [];
                const probes = diagnostics ? await import('/media-test-probes.mjs') : null;
                window.recordingTap = probes?.createRecordingTap(globalThis.AudioWorkletNode);
                const devices = new BrowserDevices({ setupSample: "/audio/P501_C_german_f1_FB_48k.wav", testDurationMs: 50,
                    // Known source signals exercise the real browser codecs and
                    // GStreamer path, not physical microphone permissions.
                    mediaDevices: { async getUserMedia() {
                        const context = new AudioContext({ sampleRate: 48000 });window.contexts.push(context);await context.resume();
                        const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
                        oscillator.frequency.value = index ? 880 : 440;oscillator.connect(destination);oscillator.start();
                        if (diagnostics) window.syntheticSources.push({context, node: oscillator, stream: destination.stream});
                        return destination.stream;
                    } }
                });
                const audio = new BrowserAudioSession({ devices, onFailure: error => window.errors.push(error.message) });window.audio = audio;
                const recordings = new MemoryRecordings({maxBytes:2000000,uploadOptions:()=>({baseUrl:url,headers:{authorization:'Bearer '+credentials.reconnectToken},chunkBytes:65536})});window.recordings=recordings;
                window.startRecording = async () => {
                    if (diagnostics) await devices.context.audioWorklet.addModule('/media-test-record-observer.js');
                    window.recorder=new PcmRecorder({context:devices.context,maxBytes:2000000,onFailure:error=>window.errors.push(error.message),
                        ...(diagnostics ? {AudioWorkletNode: window.recordingTap.Node} : {})});
                    await window.recorder.start(audio.streams());await audio.start();
                    if (diagnostics) {
                        const source = window.syntheticSources.find(source => source.stream === audio.streams().microphone);
                        window.audioProbes = Promise.all([
                            probes.captureProbe(source.context, source.node).then(value => ({stage: 'synthetic-source', ...value})),
                            probes.captureProbe(devices.context, devices.context.createMediaStreamSource(audio.streams().microphone)).then(value => ({stage: 'recorder-stream-input', ...value}))
                        ]);
                        void window.audioProbes.catch(() => {});
                    }
                };
                const client = createParticipantRuntime({ initialize: async () => ({config:{},credentials,url}), recordings, media: { command: async command => {
                    if (command.type === "remoteSignal") return audio.applySignal(command.signal);
                    if (command.type === "prepareRemote") {
                        const scope = { sessionId: command.sessionId, participantId: command.participantId, attemptId: command.attemptId };
                        window.scope=scope;
                        await audio.prepare({ scope, generation: command.generation, iceServers: command.iceServers, signal: payload => client.dispatch("signal", payload, { scope }) });window.prepared = true;
                    }
                    if (command.type === "stopCapture") await audio.stopCapture();
                    if (command.type === "stopCore") {
                        const files=await window.recorder.stop();
                        const manifests=await recordings.retain({scope:window.scope,files,status:'complete'});
                        await audio.stop();await client.dispatch('mediaStopped',{success:true,generation:command.generation},{scope:window.scope});
                        await client.dispatch('recordingsFinalized',{manifests},{scope:window.scope});window.stopped = true;
                    }
                } } });
                client.onError = error => window.errors.push(error.message);
                document.getElementById("prepare").onclick = async () => {
                    try {await devices.test({ sourceId: "default", sinkId: "default" });window.tested = true;}
                    catch (error) {window.errors.push(error.message);}
                };
                window.client = client;await client.bootstrap();
                await new Promise(resolve => client.subscribe(() => resolve()));
            }, { credentials: people[index], index, url, diagnostics });
            await page.click("#prepare");await page.waitForFunction(() => window.tested || window.errors.length, { timeout: 15000 });
            expect(await page.evaluate(() => window.errors)).toEqual([]);
        }));
        await session.mediaAdapter.prepare({ session, attempt: { contextKey: "browser-attempt" }, condition: { nativeGain: 1, echoGain: 0 } });
        await Promise.all(pages.map(page => page.waitForFunction(() => window.prepared || window.errors.length)));
        for (const page of pages) expect(await page.evaluate(() => window.errors)).toEqual([]);
        await session.mediaAdapter.request("ready");await Promise.all(pages.map(page => page.evaluate(() => window.startRecording())));await session.mediaAdapter.release();
        for (const page of pages) {
            const result = await page.evaluate(async () => {
                const streams = window.audio.streams(), context = new AudioContext({ sampleRate: 48000 });await context.resume();
                const source = context.createMediaStreamSource(streams.playback), analyser = context.createAnalyser();source.connect(analyser);analyser.fftSize = 2048;
                let peak = 0;const deadline = performance.now() + 1500;
                while (peak < .01 && performance.now() < deadline) {const data = new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);peak = Math.max(...data.map(Math.abs));await new Promise(resolve => setTimeout(resolve, 20));}
                source.disconnect();await context.close();return { peak, microphoneLive: streams.microphone.getAudioTracks()[0].readyState, playbackLive: streams.playback.getAudioTracks()[0].readyState };
            });
            expect(result.microphoneLive).toBe("live");expect(result.playbackLive).toBe("live");expect(result.peak).toBeGreaterThan(.01);
        }
        // Observe sustained content, not just the first audible codec packet.
        await new Promise(resolve=>setTimeout(resolve,3000));
        session.attempts[0].status='stopping';
        await session.mediaAdapter.stop({ reason: "completed" });await Promise.all(pages.map(page => page.waitForFunction(() => window.stopped)));
        await Promise.all(pages.map(page=>page.waitForFunction(()=>window.recordings.pending.size===0)));
        expect(session.attempts[0].receipts).toHaveLength(4);
        const evidence = [];
        for(let index=0;index<people.length;index++) {
            const directory=path.join(session.sessionDir,'attempts','browser-attempt',people[index].participantId);
            const mic=await fs.readFile(path.join(directory,'microphone.wav')),play=await fs.readFile(path.join(directory,'headphones.wav'));
            for(const bytes of [mic,play]) {expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.readUInt32LE(24)).toBe(48000);expect(bytes.length).toBeGreaterThan(1000);}
            evidence.push({ participantId: people[index].participantId, index, microphone: mic, headphones: play });
        }
        if (diagnostics) {
            const snapshots = await Promise.all(pages.map(page => page.evaluate(async () => ({probes: await window.audioProbes, recording: window.recordingTap.snapshot()}))));
            const report = [];
            for (const item of evidence) {
                const own = item.index ? 880 : 440, peer = item.index ? 440 : 880, snapshot = snapshots[item.index];
                const captures = [...snapshot.probes, ...snapshot.recording.flatMap(({inputSamples, inputWorkletRate, ...value}) => [
                    ...(inputSamples ? [{stage: `recording-worklet-input-${value.track}`, track: value.track, contextRate: value.rate, workletRate: inputWorkletRate, samples: inputSamples}] : []),
                    {stage: `recording-worklet-${value.track}`, contextRate: value.rate, workletRate: value.workletStats?.workletRate, ...value}
                ])];
                const measurements = [];
                for (const {samples, ...metadata} of captures) {
                    const pcm = Float32Array.from(samples), expectedHz = metadata.track === 'headphones' ? peer : own;
                    measurements.push({...metadata, retainedFrames: pcm.length, expectedHz, ...analyzeTone(pcm, {rate: metadata.contextRate, expectedHz, alternateHz: expectedHz === own ? peer : own})});
                    await testInfo.attach(`participant-${item.index}-${metadata.stage}.f32`, {body: Buffer.from(pcm.buffer), contentType: 'application/octet-stream'});
                }
                const encoding = snapshot.recording.map(record => {
                    const bytes = item[record.track];let mismatches = 0;
                    for (let n = 0; n < record.samples.length; n++) {
                        const value = Math.max(-1, Math.min(1, record.samples[n]));
                        if (Math.round(value < 0 ? value * 32768 : value * 32767) !== bytes.readInt16LE(44 + n * 2)) mismatches++;
                    }
                    return {track: record.track, emittedFrames: record.totalFrames, wavFrames: (bytes.length - 44) / 2, comparedFrames: record.samples.length, mismatches};
                });
                for (const [track, expectedHz] of [['microphone', own], ['headphones', peer]]) {
                    const {samples, rate} = decodePcmWav(item[track]);
                    measurements.push({stage: `final-wav-${track}`, contextRate: rate, retainedFrames: samples.length, expectedHz,
                        ...analyzeTone(samples, {rate, expectedHz, alternateHz: expectedHz === own ? peer : own})});
                }
                report.push({participantId: item.participantId, index: item.index, measurements, encoding});
            }
            await testInfo.attach('audio-boundaries', {body: JSON.stringify(report, null, 2), contentType: 'application/json'});
        }
        await inspectEvidence(evidence);
    }
    catch(error){await fs.cp(root,testInfo.outputPath('synthetic-audio-failure'),{recursive:true});throw error;}
    finally {await context.close();await app.close();await vite.close();await fs.rm(root, { recursive: true, force: true });}
}
