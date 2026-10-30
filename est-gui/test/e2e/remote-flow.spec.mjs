import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createCoordinator } = require("../../../est-server/src/server.js");
const { normalizeConfig, publicBootstrap } = require("../../../est-server/src/bootstraps/configManager.js");
const { remoteConfig } = require("../../../est-server/test/fixtures/config.js");

test("default browser runtime completes SCT and both LST roles with receipt-driven WAV collection", async ({ browser }) => {
    test.setTimeout(120000);
    const root = await fs.mkdtemp("/tmp/opencode/est-remote-flow-");
    const raw = remoteConfig();raw.conditions = { baseline: [{}], random: [] };
    raw.remote = { coreExecutable: process.env.EST_CORE_EXECUTABLE || path.resolve("../est-core/.build/linux/est-core"), internalPortRange: [35200, 35299], icePortRange: [47500, 47999], playbackDrainMs: 50, startupTimeoutMs: 20000 };
    const config = normalizeConfig(raw), app = createCoordinator({ config, root });
    const vite = await createServer({ configFile: path.resolve("vite.web.config.mjs"), server: { middlewareMode: true }, appType: "custom" });
    app.app.use(vite.middlewares);app.app.get("/flow-test", (_request, response) => response.type("html").send('<!doctype html><button id="setup">Test audio</button>'));
    app.server.listen(0, "127.0.0.1");await once(app.server, "listening");const url = "http://127.0.0.1:" + app.server.address().port;
    const people = ["flow-a", "flow-b"].map(identity => app.enrollments.admit({ identity }));
    const session = app.registry.createPair(people.map(person => app.enrollments.get(person.participantId)));
    const context = await browser.newContext(), pages = await Promise.all(people.map(() => context.newPage()));
    const bothView = async view => {await Promise.all(pages.map(page => page.waitForFunction(view => window.runtime.snapshot()?.currentView === view || window.errors.length, view)));for (const page of pages) expect(await page.evaluate(() => window.errors)).toEqual([]);};
    const next = () => Promise.all(pages.map(page => page.evaluate(() => window.runtime.dispatch("nextView", { currentView: window.runtime.snapshot().currentView }))));
    const running = async () => {await Promise.all(pages.map(page => page.waitForFunction(() => window.runtime.snapshot()?.viewData.recordingStatus === "running" || window.errors.length)));for (const page of pages) expect(await page.evaluate(() => window.errors)).toEqual([]);};
    try {
        await Promise.all(pages.map(async (page, index) => {
            await page.goto(url + "/flow-test");
            await page.evaluate(async ({ credentials, config, index, url }) => {
                const { BrowserDevices } = await import("/src/renderer/windowMain/audio/browser-devices.js");
                const { createRuntime } = await import("/src/renderer/windowMain/runtime/browser.js");
                window.errors = [];
                const devices = new BrowserDevices({ testDurationMs: 50, mediaDevices: { async getUserMedia() {
                    const context = new AudioContext({ sampleRate: 48000 });await context.resume();
                    const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();oscillator.frequency.value = index ? 880 : 440;oscillator.connect(destination);oscillator.start();return destination.stream;
                } } });
                const runtime = createRuntime({ initialize: async () => ({ credentials, config, url }), devices });window.runtime = runtime;
                runtime.onError = error => window.errors.push(error.message);await runtime.bootstrap();
                document.getElementById("setup").onclick = async () => {
                    try {const selected = { sourceId: "default", sinkId: "default" };await devices.test(selected);await devices.save(selected);await runtime.dispatch("setupComplete", { inputUsable: true, playbackConfirmed: true });window.tested = true;}
                    catch (error) {window.errors.push(error.message);}
                };
            }, { credentials: people[index], config: publicBootstrap(config), index, url });
            await page.click("#setup");await page.waitForFunction(() => window.tested || window.errors.length);expect(await page.evaluate(() => window.errors)).toEqual([]);
        }));
        await bothView("viewWelcome");await next();await bothView("viewPretest");
        await Promise.all(pages.map(page => page.evaluate(() => window.runtime.dispatch("pretest", { formData: { age: 25 } }))));
        await next();await bothView("viewShortConversationTestExplanation");await next();await running();
        await next();await bothView("viewShortConversationTestEvaluation");await next();await bothView("viewListeningSpeakingTestExplanation");
        await next();await running();
        expect(await Promise.all(pages.map(page => page.evaluate(() => window.runtime.snapshot().viewData.conditionListeningSpeakingTestRole)))).toEqual(["speaker", "listener"]);
        await next();await bothView("viewListeningSpeakingTestEvaluation");await next();await running();
        expect(await Promise.all(pages.map(page => page.evaluate(() => window.runtime.snapshot().viewData.conditionListeningSpeakingTestRole)))).toEqual(["listener", "speaker"]);
        await next();await bothView("viewListeningSpeakingTestEvaluation");await next();await bothView("viewEnding");
        expect(session.attempts).toHaveLength(3);expect(session.attempts.every(attempt => attempt.status === "completed" && attempt.receipts.length === 4)).toBe(true);
        for (const page of pages) {await page.waitForFunction(() => window.runtime.recordings.pending.size === 0);expect(await page.evaluate(() => window.errors)).toEqual([]);}
    }
    finally {await context.close();await app.close();await vite.close();await fs.rm(root, { recursive: true, force: true });}
});
