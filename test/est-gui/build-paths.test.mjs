import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {loadConfigFromFile} from './tools.mjs';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{checkoutPaths}=require('../../common/transient-paths.cjs');
const project=path.resolve(import.meta.dirname,'../../est-gui');
it('web builds and dependency caches are outside the source checkout',async()=>{
    const {default:config}=await import('../../est-gui/vite.web.config.mjs');
    const base=checkoutPaths().base;
    expect(config.build.outDir).toBe(base+'/est-gui/web');
    expect(config.cacheDir).toBe(base+'/est-gui/cache/vite-web');
    expect(config.root).toBe(project);
});
it('Electron dev/preview resolve a managed app and source inputs without bundled-config siblings',async()=>{
    expect(fs.existsSync(path.join(project,'build_scripts/run.cjs'))).toBe(true);
    const {runGui}=require('../../est-gui/build_scripts/run.cjs'),calls=[];
    for(const command of ['electron-dev','electron-preview']) {
        const code=await runGui(command,[],{spawnTool:async(executable,args,options)=>{calls.push({executable,args,...options});return 0;}});
        expect(code).toBe(0);
    }
    const app=checkoutPaths().path('est-gui','app');
    expect(JSON.parse(fs.readFileSync(path.join(app,'package.json'))).main).toBe('out/main/index.js');
    expect(fs.realpathSync(path.join(app,'node_modules'))).toBe(fs.realpathSync(path.join(project,'node_modules')));
    for(const call of calls) {
        expect(call.args.slice(-2)).toEqual(['--','--no-sandbox']);
        expect(call.cwd).toBe(project);expect(call.env.ELECTRON_ENTRY).toBe(app);expect(call.env.EST_GUI_SOURCE_ROOT).toBe(project);
        const proxy=call.args[call.args.indexOf('--config')+1];
        expect(proxy.startsWith('/tmp/effectstreamer/')).toBe(true);
        const loaded=await loadConfigFromFile({command:'build',mode:'production'},proxy,project,'silent');
        for(const part of ['main','preload','renderer']) {
            expect(loaded.config[part].build.outDir).toBe(path.join(app,'out',part));
            expect(loaded.config[part].cacheDir.startsWith(checkoutPaths().base+'/est-gui/cache/')).toBe(true);
        }
    }
});
function clonedTooling() {
    const root=checkoutPaths().temporaryDirectory('est-gui','tool-policy-'),source=path.resolve(project,'..');
    const files=['common/transient-paths.cjs','common/direct-write.cjs','common/run-tool.cjs','est-gui/build_scripts/run.cjs','est-gui/package.json','est-gui/vite.web.config.mjs'];
    for(const file of files){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(source,file),path.join(root,file));}
    fs.symlinkSync(path.join(project,'node_modules'),path.join(root,'est-gui/node_modules'),'dir');
    const {createTransientPaths}=require('../../common/transient-paths.cjs'),paths=createTransientPaths({anchor:root});
    return {root,paths,runGui:require(path.join(root,'est-gui/build_scripts/run.cjs')).runGui,
        close(){fs.rmSync(paths.base,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});}};
}
for(const command of ['web-build','electron-build'])it(`${command} rejects symlinked outputs before a tool can empty another directory`,async()=>{
    const fixture=clonedTooling(),outside=path.join(fixture.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'keep');
    const link=command==='web-build'?path.join(fixture.paths.directory('est-gui'),'web'):path.join(fixture.paths.directory('est-gui','app'),'out');
    fs.symlinkSync(outside,link);
    try {
        await expect(fixture.runGui(command,[],{spawnTool:async()=>0})).rejects.toThrow(/symlink|unsafe/i);
        if(command==='web-build')await expect(import(pathToFileURL(path.join(fixture.root,'est-gui/vite.web.config.mjs')).href)).rejects.toThrow(/symlink|unsafe/i);
        expect(fs.readFileSync(path.join(outside,'keep'),'utf8')).toBe('keep');
    } finally {fixture.close();}
});
for(const [command,args] of [['web-build',['--outDir','/outside']],['electron-build',['--outDir=/outside']],['package',['linux','--config.directories.output=/outside']],['lint',['--cache-location','/outside']]]) {
    it(`${command} rejects forwarded output/configuration overrides`,async()=>{
        const fixture=clonedTooling();
        try {await expect(fixture.runGui(command,args,{spawnTool:async()=>0})).rejects.toThrow(/unsupported|override|managed/i);}
        finally {fixture.close();}
    });
}
it('Vitest module-cache writes are configured below the managed cache rather than node_modules',async()=>{
    const {default:config}=await import('./vitest.config.mjs');
    expect(config.test.fsModuleCachePath).toBe(checkoutPaths().path('est-gui','cache','vitest-modules'));
});
it('the application lint launcher receives managed artifact paths and preserves failures',async()=>{
    expect(fs.existsSync(path.join(project,'build_scripts/run.cjs'))).toBe(true);
    const {runGui}=require('../../est-gui/build_scripts/run.cjs');
    let call;expect(await runGui('lint',[],{spawnTool:async(executable,args,options)=>{call={args,...options};return 9;}})).toBe(9);
    expect(call.env.TMPDIR.startsWith('/tmp/effectstreamer/')).toBe(true);
    expect(call.args[call.args.indexOf('--cache-location')+1].startsWith('/tmp/effectstreamer/')).toBe(true);
});
it('GUI builds refuse a competing stable-output lock',async()=>{
    expect(fs.existsSync(path.join(project,'build_scripts/run.cjs'))).toBe(true);
    const {runGui}=require('../../est-gui/build_scripts/run.cjs'),release=checkoutPaths().acquireLock('est-gui','electron');
    try {await expect(runGui('electron-build',[],{spawnTool:async()=>0})).rejects.toThrow(/lock/i);} finally {release();}
});
