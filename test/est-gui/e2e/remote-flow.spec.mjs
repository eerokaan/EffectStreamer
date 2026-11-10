import { test, expect } from "@playwright/test";
import { createServer } from "../tools.mjs";
import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const {checkoutPaths}=require('../../../common/transient-paths.cjs');
const { createCoordinator } = require("../../../est-server/src/server.js");
const { normalizeConfig } = require("../../../est-server/src/bootstraps/configManager.js");
const { remoteConfig } = require("../../est-server/fixtures/config.js");

for (const recover of [false,true]) test("public Prolific entry pairs the default browser runtime through SCT/LST, WAV receipts and completion"+(recover?" after network recovery":""), async ({ browser }) => {
    test.setTimeout(120000);
    const root = checkoutPaths().temporaryDirectory('est-gui','est-remote-flow-');
    const raw = remoteConfig();raw.conditions = { baseline: [{}], random: [] };
    raw.pretestForm=[{name:'age',type:'input',inputType:'number',label:'Age',validation:{valueType:'integer',min:18}}];
    raw.prolific={enabled:true,studyId:'browser-study',completionCodes:{completed:'FINISH',technicalFailure:'TECH',partnerLeft:'LEFT',waitingTimeout:'WAIT'}};
    raw.remote = { coreExecutable: process.env.EST_CORE_EXECUTABLE || checkoutPaths().path('est-core','build','linux','est-core'), internalPortRange: [35200, 35299], icePortRange: [47500, 47999], playbackDrainMs: 50, startupTimeoutMs: 20000 };
    const config = normalizeConfig(raw), app = createCoordinator({ config, root });
    const vite = await createServer({ configFile: path.resolve("vite.web.config.mjs"), configLoader:'runner', server: { middlewareMode: true }, appType: "custom" });
    app.app.use(vite.middlewares);app.app.get("/flow-test", (_request, response) => response.type("html").send('<!doctype html><button id="setup">Test audio</button>'));
    app.server.listen(0, "127.0.0.1");await once(app.server, "listening");const url = "http://127.0.0.1:" + app.server.address().port;
    let session;
    const contexts = await Promise.all([0,1].map(() => browser.newContext())), pages = await Promise.all(contexts.map(context => context.newPage()));
    const bothView = async view => {await Promise.all(pages.map(page => page.waitForFunction(view => window.runtime.snapshot()?.currentView === view || window.errors.length, view)));for (const page of pages) expect(await page.evaluate(() => window.errors)).toEqual([]);};
    const next = () => Promise.all(pages.map(page => page.evaluate(() => {
        const snapshot=window.runtime.snapshot(),evaluation=snapshot.currentView.endsWith('Evaluation');
        const keys=snapshot.currentView==='viewShortConversationTestEvaluation'?['audio_quality','noisiness','discontinuity','coloration','loudness','echo','degradation','interaction']:snapshot.viewData.conditionListeningSpeakingTestRole==='speaker'?['audio_quality','echo','degradation']:['audio_quality','noisiness','discontinuity','coloration','loudness'];
        return window.runtime.dispatch(evaluation?'submitRating':'nextView',{currentView:snapshot.currentView,...(evaluation?{scaleValues:Object.fromEntries(keys.map(key=>[key,.5]))}:{})});
    })));
    const running = async () => {await Promise.all(pages.map(page => page.waitForFunction(() => window.runtime.snapshot()?.viewData.recordingStatus === "running" || window.errors.length,null,{timeout:20000})));for (const page of pages) expect(await page.evaluate(() => window.errors)).toEqual([]);};
    try {
        await Promise.all(pages.map(async (page, index) => {
            await page.goto(url + "/flow-test?PROLIFIC_PID=browser-person-"+index+"&STUDY_ID=browser-study&SESSION_ID=browser-submission-"+index);
            await page.evaluate(async ({ index }) => {
                const { BrowserDevices } = await import("/src/renderer/windowMain/audio/browser-devices.js");
                const { createRuntime } = await import("/src/renderer/windowMain/runtime/browser.js");
                window.errors = [];
                const devices = new BrowserDevices({ testDurationMs: 50, mediaDevices: { async getUserMedia() {
                    const context = new AudioContext({ sampleRate: 48000 });await context.resume();
                    const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();oscillator.frequency.value = index ? 880 : 440;oscillator.connect(destination);oscillator.start();return destination.stream;
                } } });
                const runtime = createRuntime({ devices });window.runtime = runtime;
                runtime.onError = error => window.errors.push(error.message);await runtime.bootstrap();
                document.getElementById("setup").onclick = async () => {
                    try {const selected = { sourceId: "default", sinkId: "default" };await devices.test(selected);await devices.save(selected);await runtime.dispatch("setupComplete", { inputUsable: true, playbackConfirmed: true });window.tested = true;}
                    catch (error) {window.errors.push(error.message);}
                };
            }, { index });
            await page.click("#setup");await page.waitForFunction(() => window.tested || window.errors.length);expect(await page.evaluate(() => window.errors)).toEqual([]);
        }));
        await bothView("viewWelcome");await next();await bothView("viewPretest");
        await Promise.all(pages.map(page => page.evaluate(() => window.runtime.dispatch("pretest", { formData: { age: 25 } }))));
        await next();await bothView("viewShortConversationTestExplanation");session=[...app.registry.sessions.values()][0];await next();await running();
        if(recover) {
            const interrupted=session.recordingContextActive;
            await contexts[0].setOffline(true);await expect.poll(()=>session.phase,{timeout:25000}).toBe('interrupted');
            await contexts[0].setOffline(false);
            await Promise.all(pages.map(page=>page.waitForFunction(()=>window.runtime.snapshot()?.phase==='interrupted'&&!window.runtime.recordings.active&&!window.runtime.devices.active,null,{timeout:20000})));
            await Promise.all(pages.map(async page=>{await page.evaluate(()=>{window.tested=false;window.errors=[];});await page.click('#setup');await page.waitForFunction(()=>window.tested||window.errors.length);expect(await page.evaluate(()=>window.errors)).toEqual([]);}));
            await Promise.all(pages.map(page=>page.evaluate(()=>window.runtime.dispatch('ready',{currentView:'viewInterrupted'}))));await running();
            expect(session.recordingContextActive).not.toBe(interrupted);expect(session.attempts[0].status).toBe('interrupted');
            expect(session.attempts[0].receipts).toHaveLength(4);
        }
        await next();await bothView("viewShortConversationTestEvaluation");await next();await bothView("viewListeningSpeakingTestExplanation");
        await next();await running();
        const slots=await Promise.all(pages.map(page=>page.evaluate(()=>window.runtime.snapshot().role)));
        expect([...slots].sort()).toEqual(['a','b']);
        expect(await Promise.all(pages.map(page => page.evaluate(() => window.runtime.snapshot().viewData.conditionListeningSpeakingTestRole)))).toEqual(slots.map(role=>role==='a'?'speaker':'listener'));
        await next();await bothView("viewListeningSpeakingTestEvaluation");await next();await running();
        expect(await Promise.all(pages.map(page => page.evaluate(() => window.runtime.snapshot().viewData.conditionListeningSpeakingTestRole)))).toEqual(slots.map(role=>role==='a'?'listener':'speaker'));
        await next();await bothView("viewListeningSpeakingTestEvaluation");await next();await bothView("viewEnding");
        expect(session.attempts).toHaveLength(recover?4:3);expect(session.attempts.filter(attempt=>attempt.status==='completed')).toHaveLength(3);expect(session.attempts.every(attempt => attempt.receipts.length === 4)).toBe(true);
        for (const page of pages) {await page.waitForFunction(() => window.runtime.recordings.pending.size === 0);expect(await page.evaluate(() => window.errors)).toEqual([]);expect(await page.evaluate(()=>window.runtime.snapshot().viewData.completion)).toEqual({outcome:'completed',code:'FINISH',url:'https://app.prolific.com/submissions/complete?cc=FINISH'});}
    }
    catch(error) {
        console.error('Recovery fixture state:',JSON.stringify({server:session?.manifest(),clients:await Promise.all(pages.map(page=>page.evaluate(()=>({snapshot:window.runtime?.snapshot(),active:Boolean(window.runtime?.recordings.active),devicesActive:window.runtime?.devices.active,pending:window.runtime?.recordings.pending.size,errors:window.errors})).catch(()=>null)))}));throw error;
    }
    finally {await Promise.allSettled(contexts.map(context=>context.close()));await app.close();await vite.close();await fs.rm(root, { recursive: true, force: true });}
});
