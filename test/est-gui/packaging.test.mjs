import {it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getCoreSpawnOptions} from '../../est-gui/src/main/lib/coreProcess.js';
const require=createRequire(import.meta.url),guiRequire=createRequire(new URL('../../est-gui/package.json',import.meta.url));
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {runtimeFixture,runtimeCheckout}=require('../est-core/fixtures/runtime-sdk.cjs');

it('native launch selects the core from the application resources',()=>{
    const base=path.join(import.meta.dirname,'application-resources','est-core');
    const filename=process.platform==='win32'?'est-core.exe':'est-core';
    expect(getCoreSpawnOptions('receiver',{base}).executable).toBe(path.join(base,filename));
});

it('native packaging refuses missing source inputs rather than silently shipping tracked binaries',async()=>{
    const names=['SDK','EST_NETSIM_PLUGIN','EST_GUI_CORE_RESOURCES'];
    const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
    const root=checkoutPaths().temporaryDirectory('est-gui','pack-missing-');
    const afterPack=require('../../est-gui/build_scripts/afterPack.js');
    try {for(const name of names)delete process.env[name];await expect(afterPack({electronPlatformName:'linux',appOutDir:root,packager:{config:{}}})).rejects.toThrow(/inputs.*required/);}
    finally {await fs.rm(root,{recursive:true,force:true});for(const [name,value] of Object.entries(original)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
for(const target of ['linux','win'])it(`${target} packaged native resources are written into their actual destination`,async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','pack-native-'),input=runtimeFixture(root,target);
    const {checkout,paths}=runtimeCheckout(root,input,['est-gui/build_scripts/afterPack.js','est-core/build_scripts/stage-runtime.cjs']);
    const afterPack=require(path.join(checkout,'est-gui/build_scripts/afterPack.js'));
    const names=['SDK','EST_NETSIM_PLUGIN','EST_GUI_CORE_RESOURCES'],original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
    try {
        process.env.SDK=input.sdk;process.env.EST_NETSIM_PLUGIN=input.netsimPlugin;delete process.env.EST_GUI_CORE_RESOURCES;
        const appOutDir=path.join(root,'app');await fs.mkdir(path.join(appOutDir,'resources'),{recursive:true});
        await afterPack({electronPlatformName:target==='win'?'win32':'linux',appOutDir});
        expect(await fs.readFile(path.join(appOutDir,'resources/est-core/est-core'+(target==='win'?'.exe':'')),'utf8')).toBe('source-built-core');
        await expect(afterPack({electronPlatformName:target==='win'?'win32':'linux',appOutDir})).rejects.toThrow(/exist|overwrite/i);
    } finally {await fs.rm(root,{recursive:true,force:true});await fs.rm(paths.base,{recursive:true,force:true});for(const [name,value] of Object.entries(original)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
for(const target of ['linux','win'])it(`${target} uses the exact distribution override and packages the shared native audio`,async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','pack-command-'),original=process.env.EST_DISTRIBUTION_DIR,calls=[];
    try {
        process.env.EST_DISTRIBUTION_DIR=path.join(root,'dist');
        const {runGui}=require('../../est-gui/build_scripts/run.cjs');
        expect(await runGui('package',[target,'--dir'],{spawnTool:async(executable,args,options)=>{calls.push({args,...options});return 0;}})).toBe(0);
        expect(calls).toHaveLength(2);
        const config=JSON.parse(await fs.readFile(calls[1].args[calls[1].args.indexOf('--config')+1]));
        expect(config.directories.output).toBe(process.env.EST_DISTRIBUTION_DIR);
        expect(config.directories.app).toBe(checkoutPaths().path('est-gui','app'));
        expect(calls[1].args[calls[1].args.indexOf('--projectDir')+1]).toBe(config.directories.app);
        const {getConfig}=guiRequire('app-builder-lib/out/util/config/config.js');
        const effective=await getConfig(config.directories.app,calls[1].args[calls[1].args.indexOf('--config')+1],null);
        expect(effective.extraResources).toEqual([{from:path.resolve(import.meta.dirname,'../../est-gui/src/shared/public/audio'),to:'audio'}]);
        for (const language of ['german','english']) {
            const wav=await fs.readFile(path.join(effective.extraResources[0].from,`P501_C_${language}_f1_FB_48k.wav`));
            expect(wav.toString('ascii',0,4)).toBe('RIFF');expect(wav.readUInt32LE(24)).toBe(48000);
        }
        await expect(runGui('package',[target],{spawnTool:async()=>0})).rejects.toThrow(/exist|overwrite/i);
    } finally {await fs.rm(root,{recursive:true,force:true});if(original===undefined)delete process.env.EST_DISTRIBUTION_DIR;else process.env.EST_DISTRIBUTION_DIR=original;}
});
it('web builds reserve the exact override before invoking Vite and refuse a second build there',async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','web-command-'),original=process.env.EST_DISTRIBUTION_DIR;
    const output=path.join(root,'external','site');process.env.EST_DISTRIBUTION_DIR=output;
    const {runGui}=require('../../est-gui/build_scripts/run.cjs');
    try {
        const calls=[];expect(await runGui('web-build',[],{spawnTool:async(_node,args)=>{calls.push(args);return 0;}})).toBe(0);
        expect(await fs.readdir(output)).toEqual([]);
        expect(calls[0][calls[0].indexOf('--outDir')+1]).toBe(output);
        await fs.writeFile(path.join(output,'keep'),'keep');
        await expect(runGui('web-build',[],{spawnTool:async()=>0})).rejects.toThrow(/exist|overwrite/i);
        expect(await fs.readFile(path.join(output,'keep'),'utf8')).toBe('keep');
    } finally {await fs.rm(root,{recursive:true,force:true});if(original===undefined)delete process.env.EST_DISTRIBUTION_DIR;else process.env.EST_DISTRIBUTION_DIR=original;}
});
it('a failed GUI package command reports the incomplete destination and preserves the failure status',async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','pack-error-'),previous=process.env.EST_DISTRIBUTION_DIR,messages=[];
    process.env.EST_DISTRIBUTION_DIR=path.join(root,'dist');const spy=vi.spyOn(console,'error').mockImplementation(message=>messages.push(String(message)));
    try {
        const {runGui}=require('../../est-gui/build_scripts/run.cjs');expect(await runGui('package',['linux'],{spawnTool:async()=>7})).toBe(7);
        expect(messages.join('\n')).toContain(process.env.EST_DISTRIBUTION_DIR);expect(messages.join('\n')).toMatch(/incomplete/i);
    } finally {spy.mockRestore();await fs.rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.EST_DISTRIBUTION_DIR;else process.env.EST_DISTRIBUTION_DIR=previous;}
});
it.skipIf(!process.env.EST_PACKAGED_GUI_DIR)('the packaged Electron resources contain the source core, P.501 and Node-only common runtime',async()=>{
    const base=path.resolve(process.env.EST_PACKAGED_GUI_DIR),resources=path.join(base,'resources');
    const core=await fs.readFile(path.join(resources,'est-core/est-core')),source=await fs.readFile(checkoutPaths().path('est-core','build','linux','est-core'));
    expect(createHash('sha256').update(core).digest('hex')).toBe(createHash('sha256').update(source).digest('hex'));
    for (const language of ['german','english']) {
        const wav=await fs.readFile(path.join(resources,`audio/P501_C_${language}_f1_FB_48k.wav`));
        expect(wav.toString('ascii',0,4)).toBe('RIFF');expect(wav.readUInt32LE(24)).toBe(48000);
    }
    const {listPackage}=require('@electron/asar');const files=listPackage(path.join(resources,'app.asar'));
    expect(files).toContain('/node_modules/@effectstreamer/common/core-environment.cjs');
    expect(files).toContain('/out/main/index.js');
    for (const language of ['german','english']) {
        expect(files).toContain(`/out/renderer/audio/P501_C_${language}_f1_FB_48k.wav`);
    }
});
