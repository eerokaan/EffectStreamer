import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createCoordinator } = require("../../../est-server/src/server.js");
const { normalizeConfig } = require("../../../est-server/src/bootstraps/configManager.js");
const { remoteConfig } = require("../../../est-server/test/fixtures/config.js");

test("real browser peers negotiate, record distinct PCM taps, upload by receipt, and close cleanly", async ({ browser }) => {
    const root = await fs.mkdtemp("/tmp/opencode/est-browser-media-");
    const raw = remoteConfig(); raw.remote = { coreExecutable: process.env.EST_CORE_EXECUTABLE || path.resolve("../est-core/.build/linux/est-core"), internalPortRange: [35100, 35199], icePortRange: [47000, 47499], playbackDrainMs: 20, startupTimeoutMs: 20000 };
    const app = createCoordinator({ config: normalizeConfig(raw), root });
    const vite = await createServer({ configFile: path.resolve("vite.web.config.mjs"), server: { middlewareMode: true }, appType: "custom" });
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
            await page.evaluate(async ({ credentials, index, url }) => {
                const { BrowserDevices } = await import("/src/renderer/windowMain/audio/browser-devices.js");
                const { BrowserAudioSession } = await import("/src/renderer/windowMain/audio/browser-session.js");
                const { createParticipantRuntime } = await import("/src/renderer/windowMain/runtime/create-runtime.js");
                const { PcmRecorder } = await import("/src/renderer/windowMain/audio/pcm-recorder.js");
                const { MemoryRecordings } = await import("/src/renderer/windowMain/audio/memory-recordings.js");
                window.errors = [];window.contexts = [];
                const devices = new BrowserDevices({ testAsset: "/audio/P501_C_german_f1_FB_48k.wav", testDurationMs: 50,
                    // Known source signals exercise the real browser codecs and
                    // GStreamer path, not physical microphone permissions.
                    mediaDevices: { async getUserMedia() {
                        const context = new AudioContext({ sampleRate: 48000 });window.contexts.push(context);await context.resume();
                        const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
                        oscillator.frequency.value = index ? 880 : 440;oscillator.connect(destination);oscillator.start();return destination.stream;
                    } }
                });
                const audio = new BrowserAudioSession({ devices, onFailure: error => window.errors.push(error.message) });window.audio = audio;
                const recordings = new MemoryRecordings({maxBytes:2000000,uploadOptions:()=>({baseUrl:url,headers:{authorization:'Bearer '+credentials.reconnectToken},chunkBytes:65536})});window.recordings=recordings;
                window.startRecording = async () => {window.recorder=new PcmRecorder({context:devices.context,maxBytes:2000000,onFailure:error=>window.errors.push(error.message)});await window.recorder.start(audio.streams());await audio.start();};
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
            }, { credentials: people[index], index, url });
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
        session.attempts[0].status='stopping';
        await session.mediaAdapter.stop({ reason: "completed" });await Promise.all(pages.map(page => page.waitForFunction(() => window.stopped)));
        await Promise.all(pages.map(page=>page.waitForFunction(()=>window.recordings.pending.size===0)));
        expect(session.attempts[0].receipts).toHaveLength(4);
        for(let index=0;index<people.length;index++) {
            const directory=path.join(session.sessionDir,'attempts','browser-attempt',people[index].participantId);
            const mic=await fs.readFile(path.join(directory,'microphone.wav')),play=await fs.readFile(path.join(directory,'headphones.wav'));
            for(const bytes of [mic,play]) {expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.readUInt32LE(24)).toBe(48000);expect(bytes.length).toBeGreaterThan(1000);}
            const power=(bytes,hz)=>{let real=0,imag=0;const length=Math.min(12000,(bytes.length-44)/2);for(let n=0;n<length;n++){const sample=bytes.readInt16LE(44+n*2);real+=sample*Math.cos(2*Math.PI*hz*n/48000);imag+=sample*Math.sin(2*Math.PI*hz*n/48000);}return real*real+imag*imag;};
            const own=index?880:440,peer=index?440:880;
            expect(power(mic,own)).toBeGreaterThan(power(mic,peer)*10);
            expect(power(play,peer)).toBeGreaterThan(power(play,own)*10);
        }
    }
    finally {await context.close();await app.close();await vite.close();await fs.rm(root, { recursive: true, force: true });}
});
