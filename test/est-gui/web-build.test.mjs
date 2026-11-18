import { it, expect } from "vitest";
import { build } from "./tools.mjs";
import { fileURLToPath } from "node:url";
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {checkoutPaths}=createRequire(import.meta.url)('../../common/transient-paths.cjs');

it("builds a publishable index with renderer styles, shared audio and no native modules", async ({onTestFinished}) => {
    const outDir=checkoutPaths().temporaryDirectory('est-gui','web-bundle-');
    onTestFinished(()=>fs.rm(outDir,{recursive:true,force:true}));
    const result = await build({ configFile: fileURLToPath(new URL("../../est-gui/vite.web.config.mjs", import.meta.url)), configLoader:'runner', logLevel: "silent", build: { outDir } });
    const html=await fs.readFile(path.join(outDir,'index.html'),'utf8');
    const [script]=html.match(/\/assets\/[^" ]+\.js/g) || [];
    const [style]=html.match(/\/assets\/[^" ]+\.css/g) || [];
    expect((await fs.stat(path.join(outDir,script))).size).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(outDir,style),'utf8')).toContain('.min-h-screen');
    for(const language of ['english','german']) {
        const name=`P501_C_${language}_f1_FB_48k.wav`;
        const wav=await fs.readFile(path.join(outDir,'audio',name));
        expect(wav.toString('ascii',0,4)).toBe('RIFF');expect(wav.readUInt32LE(24)).toBe(48000);
        expect(wav.equals(await fs.readFile(new URL(`../../est-gui/src/shared/public/audio/${name}`,import.meta.url)))).toBe(true);
    }
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
// This checks dependency isolation, not build speed on a shared filesystem.
}, 120000);
