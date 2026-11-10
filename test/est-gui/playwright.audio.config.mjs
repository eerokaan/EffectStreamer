import { defineConfig } from "@playwright/test";
import path from 'node:path';
import {createRequire} from 'node:module';
const {testEnvironment}=createRequire(import.meta.url)('../environment.cjs');
const environment=testEnvironment('est-gui');Object.assign(process.env,environment);
const run=environment.EST_TRANSIENT_RUN_DIR;
// The matching native SDK belongs to server/core children only. Its cairo/GST
// libraries must not shadow the host libraries used by the browser executables.
const { LD_LIBRARY_PATH, GST_PLUGIN_SYSTEM_PATH, GST_PLUGIN_PATH, ...browserEnv } = process.env;
export default defineConfig({
    outputDir:path.join(run,'test-results'),
    reporter:[['list'],['html',{outputFolder:path.join(run,'playwright-report'),open:'never'}]],
    testDir: "./e2e", testMatch: /(?:browser-media|remote-flow)\.spec\.mjs$/, timeout: 60000, workers: 1,
    use: { headless: true, launchOptions: { env: browserEnv } },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        { name: "firefox", use: { browserName: "firefox" } },
        { name: "webkit", use: { browserName: "webkit" } }
    ]
});
