import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const beforePack=require('../build_scripts/beforePack.js');

it('native packaging refuses missing source inputs rather than silently shipping tracked binaries',async()=>{
    const names=['SDK','EST_NETSIM_PLUGIN','EST_CORE_EXECUTABLE','EST_GUI_CORE_RESOURCES'];
    const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
    try {for(const name of names)delete process.env[name];await expect(beforePack({electronPlatformName:'linux',packager:{config:{}}})).rejects.toThrow(/inputs.*required/);}
    finally {for(const [name,value] of Object.entries(original)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
it.skipIf(!process.env.EST_PACKAGED_GUI_DIR)('the packaged Electron resources contain the source core, P.501 and Node-only common runtime',async()=>{
    const base=path.resolve(process.env.EST_PACKAGED_GUI_DIR),resources=path.join(base,'resources');
    const core=await fs.readFile(path.join(resources,'est-core/est-core')),source=await fs.readFile(path.resolve('../est-core/.build/linux/est-core'));
    expect(createHash('sha256').update(core).digest('hex')).toBe(createHash('sha256').update(source).digest('hex'));
    const wav=await fs.readFile(path.join(resources,'audio/P501_C_german_f1_FB_48k.wav'));expect(wav.toString('ascii',0,4)).toBe('RIFF');expect(wav.readUInt32LE(24)).toBe(48000);
    const {listPackage}=require('@electron/asar');const files=listPackage(path.join(resources,'app.asar'));
    expect(files).toContain('/node_modules/@effectstreamer/common/core-environment.cjs');
    expect(files).toContain('/out/main/index.js');
});
