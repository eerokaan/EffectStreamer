import { it, expect } from "vitest";
import { build } from "vite";
import { fileURLToPath } from "node:url";

it("builds the shared renderer for the web without native runtime or Node/Electron modules", async () => {
    const result = await build({ configFile: fileURLToPath(new URL("../vite.web.config.mjs", import.meta.url)), logLevel: "silent", build: { write: false } });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
    const chunks = outputs.filter(value => value.type === "chunk");
    expect(chunks.length).toBeGreaterThan(0);
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    expect(modules.some(id => id.includes("runtime/browser.js"))).toBe(true);
    expect(modules.some(id => /runtime\/electron\.js|\/src\/(main|preload)\/|helper-webrtc/.test(id))).toBe(false);
    for (const chunk of chunks) {
        expect(chunk.imports.some(id => /^(node:|electron$)/.test(id))).toBe(false);
        expect(chunk.code).not.toContain("window.appApi");
    }
}, 30000);
