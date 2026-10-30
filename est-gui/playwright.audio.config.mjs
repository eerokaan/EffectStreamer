import { defineConfig } from "@playwright/test";
// The matching native SDK belongs to server/core children only. Its cairo/GST
// libraries must not shadow the host libraries used by the browser executables.
const { LD_LIBRARY_PATH, GST_PLUGIN_SYSTEM_PATH, GST_PLUGIN_PATH, ...browserEnv } = process.env;
export default defineConfig({
    testDir: "./test/e2e", testMatch: /(?:browser-media|remote-flow)\.spec\.mjs$/, timeout: 60000, workers: 1,
    use: { headless: true, launchOptions: { env: browserEnv } },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        { name: "firefox", use: { browserName: "firefox" } },
        { name: "webkit", use: { browserName: "webkit" } }
    ]
});
