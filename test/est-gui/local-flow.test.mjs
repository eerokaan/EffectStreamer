import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import dgram from "node:dgram";
import { once } from "node:events";
import { createRequire } from "node:module";
import { NativeAudioRuntime } from "../../est-gui/src/main/audio/native.js";
import { handleNativeCommand } from "../../est-gui/src/main/audio/command-handler.js";
import { createRuntime } from "../../est-gui/src/renderer/windowMain/runtime/electron.js";

const require = createRequire(import.meta.url);
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const { createCoordinator } = require("../../est-server/src/server.js");
const { normalizeConfig } = require("../../est-server/src/bootstraps/configManager.js");

function waitFor(runtime, predicate) {
    return new Promise((resolve, reject) => {
        let remove = () => {};
        const timer = setTimeout(() => {remove();reject(new Error("Local flow timed out: " + JSON.stringify(runtime.snapshot())));}, 10000);
        remove = runtime.subscribe(snapshot => {if (predicate(snapshot)) {clearTimeout(timer);remove();resolve(snapshot);}});
        if (runtime.snapshot() && predicate(runtime.snapshot())) {clearTimeout(timer);remove();resolve(runtime.snapshot());}
    });
}

it.skipIf(process.env.EST_NATIVE_INTEGRATION !== "1")("runs SCT and both LST role rounds through shared runtime, real native cores and receipt-driven uploads", async () => {
    const root = checkoutPaths().temporaryDirectory('est-gui','est-local-flow-');
    const raw = structuredClone(require("../../est-server/est-server.config.local.example.json"));
    raw.conditions = { baseline: [{}], random: [] };
    const config = normalizeConfig(raw), app = createCoordinator({ config, root: path.join(root, "server") });
    app.server.listen(0, "127.0.0.1");await once(app.server, "listening");
    const url = "http://127.0.0.1:" + app.server.address().port;
    const credentials = ["client-a", "client-b"].map(identity => app.enrollments.admit({ identity, ipAddress: "127.0.0.1", operatingSystem: "linux" }));
    const session = app.registry.createPair(credentials.map(item => app.enrollments.get(item.participantId)));
    const sockets = Array.from({ length: 6 }, () => dgram.createSocket("udp4"));
    await Promise.all(sockets.map(socket => new Promise(resolve => socket.bind(0, "127.0.0.1", resolve))));
    const ports = sockets.map(socket => socket.address().port);
    await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
    [...session.clientsData.values()].forEach((client, index) => {client.ports = { listen: ports[index * 3], echo: ports[index * 3 + 1], record: ports[index * 3 + 2] };});
    const errors = [], deviceCalls = [];
    const audios = credentials.map((_, index) => new NativeAudioRuntime({ config: { audio: { backend: "native", devices: { source: "null", sink: "null" } } }, executable: process.env.EST_CORE_EXECUTABLE || checkoutPaths().path('est-core','build','linux','est-core'), platform: "linux", recordingRoot: path.join(root, "client-" + index), setupSample: "unused", onFailure: error => errors.push(error.message) }));
    const runtimes = credentials.map((item, index) => {
        const initialized = { url, credentials: item, config: { mode: "local", setupRequired: false, sessionLanguage: config.sessionLanguage, recordings: config.recordings } };
        return createRuntime({ bridge: { invoke(operation, payload) {
            if (operation === "configuration") return initialized.config;
            if (operation === "bootstrap") return initialized;
            if (operation === "media.command") return handleNativeCommand(audios[index], payload);
            if (operation === "recordings.collect") return audios[index].collect(payload, initialized);
            if (operation === "media.dispose") return audios[index].dispose();
            deviceCalls.push(operation);throw new Error("Unexpected device permission/setup operation");
        } } });
    });
    runtimes.forEach(runtime => {runtime.onError = error => errors.push(error.message);});
    const next = async () => Promise.all(runtimes.map(runtime => {
        const snapshot=runtime.snapshot(),evaluation=snapshot.currentView.endsWith('Evaluation');
        const keys=snapshot.currentView==='viewShortConversationTestEvaluation'?['audio_quality','noisiness','discontinuity','coloration','loudness','echo','degradation','interaction']:snapshot.viewData.conditionListeningSpeakingTestRole==='speaker'?['audio_quality','echo','degradation']:['audio_quality','noisiness','discontinuity','coloration','loudness'];
        return runtime.dispatch(evaluation?'submitRating':'nextView',{currentView:snapshot.currentView,...(evaluation?{scaleValues:Object.fromEntries(keys.map(key=>[key,.5]))}:{})});
    }));
    const bothView = view => Promise.all(runtimes.map(runtime => waitFor(runtime, snapshot => snapshot.currentView === view)));
    try {
        await Promise.all(runtimes.map(runtime => runtime.bootstrap()));await bothView("viewWelcome");
        await next();await bothView("viewPretest");
        await Promise.all(runtimes.map(runtime => runtime.dispatch("pretest", { formData: { "input-age": 25, "select-gender": "other", "select-german-proficiency": "native", "select-hours-internet": "less-than-3h", "select-hours-calls": "less-than-3h" } })));
        await next();await bothView("viewShortConversationTestExplanation");
        await next();await Promise.all(runtimes.map(runtime => waitFor(runtime, snapshot => snapshot.viewData.recordingStatus === "running")));
        await next();await bothView("viewShortConversationTestEvaluation");
        await next();await bothView("viewListeningSpeakingTestExplanation");
        await next();await Promise.all(runtimes.map(runtime => waitFor(runtime, snapshot => snapshot.viewData.recordingStatus === "running")));
        expect(runtimes.map(runtime => runtime.snapshot().viewData.conditionListeningSpeakingTestRole)).toEqual(["speaker", "listener"]);
        await next();await bothView("viewListeningSpeakingTestEvaluation");
        await next();await Promise.all(runtimes.map(runtime => waitFor(runtime, snapshot => snapshot.viewData.recordingStatus === "running")));
        expect(runtimes.map(runtime => runtime.snapshot().viewData.conditionListeningSpeakingTestRole)).toEqual(["listener", "speaker"]);
        await next();await bothView("viewListeningSpeakingTestEvaluation");await next();await bothView("viewEnding");
        expect(session.attempts).toHaveLength(3);
        expect(session.attempts.every(attempt => attempt.status === "completed" && attempt.receipts.length === 4)).toBe(true);
        expect(deviceCalls).toEqual([]);expect(errors).toEqual([]);
    }
    finally {await Promise.all(runtimes.map(runtime => runtime.dispose().catch(() => {})));await app.close();await fs.rm(root, { recursive: true, force: true });}
}, 40000);
