import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build,loadConfigFromFile} from './tools.mjs';
const require=createRequire(import.meta.url),{checkoutPaths}=require('../../common/transient-paths.cjs');
const project=path.resolve(import.meta.dirname,'../../est-gui');
beforeEach(()=>vi.stubEnv('EST_DISTRIBUTION_DIR',undefined));
afterEach(()=>vi.unstubAllEnvs());
it('the browser entry is isolated from native entries, with shared public assets and private caches',async()=>{
    const {default:config}=await import('../../est-gui/vite.web.config.mjs');
    const base=checkoutPaths().base;
    expect(config.cacheDir).toBe(base+'/est-gui/cache/vite-web');
    expect(config.root).toBe(path.join(project,'src/web'));
    expect(fs.existsSync(path.join(config.root,'index.html'))).toBe(true);
    expect(config.publicDir).toBe(path.join(project,'src/shared/public'));
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
        expect(loaded.config.renderer.publicDir).toBe(path.join(project,'src/shared/public'));
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
it('standalone Vite builds require an explicit destination instead of silently publishing a second bundle',async()=>{
    const fixture=clonedTooling();
    try {
        const gui=path.join(fixture.root,'est-gui');
        fs.mkdirSync(path.join(gui,'src/web'),{recursive:true});
        fs.writeFileSync(path.join(gui,'src/web/index.html'),'<!doctype html><title>Build fixture</title>');
        await expect(build({configFile:path.join(gui,'vite.web.config.mjs'),configLoader:'runner',logLevel:'silent'})).rejects.toThrow(/build:web|outDir/);
    } finally {fixture.close();}
});
it('electron-build rejects a symlinked application output before a tool can empty another directory',async()=>{
    const fixture=clonedTooling(),outside=path.join(fixture.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'keep');
    fs.symlinkSync(outside,path.join(fixture.paths.directory('est-gui','app'),'out'));
    try {
        await expect(fixture.runGui('electron-build',[],{spawnTool:async()=>0})).rejects.toThrow(/symlink|unsafe/i);
        expect(fs.readFileSync(path.join(outside,'keep'),'utf8')).toBe('keep');
    } finally {fixture.close();}
});
const releases=[['web','web-build',[]],['linux','package',['linux']],['win','package',['win']]];
for(const [target,command,args] of releases)it(`${target} reserves only its target under dist and refuses an existing release`,async()=>{
    const fixture=clonedTooling(),dist=path.join(fixture.root,'est-gui/dist'),targetDir=path.join(dist,target);
    const legacy=path.join(dist,'EffectStreamer-1.0.0-Linux.AppImage');
    try {
        fs.mkdirSync(dist);fs.writeFileSync(legacy,'legacy');
        const calls=[];
        expect(await fixture.runGui(command,args,{spawnTool:async(_node,argv)=>{calls.push(argv);return 0;}})).toBe(0);
        expect(fs.statSync(targetDir).isDirectory()).toBe(true);
        const argv=calls.at(-1);
        const output=command==='web-build'?argv[argv.indexOf('--outDir')+1]:JSON.parse(fs.readFileSync(argv[argv.indexOf('--config')+1])).directories.output;
        expect(output).toBe(targetDir);
        fs.writeFileSync(path.join(targetDir,'keep'),'release');
        await expect(fixture.runGui(command,args,{spawnTool:async()=>0})).rejects.toThrow(/exist|overwrite/i);
        expect(fs.readFileSync(path.join(targetDir,'keep'),'utf8')).toBe('release');
        expect(fs.readFileSync(legacy,'utf8')).toBe('legacy');
    } finally {fixture.close();}
});
for(const [target,command,args] of releases)it(`${target} refuses a symlinked dist ancestor or target`,async()=>{
    const fixture=clonedTooling(),dist=path.join(fixture.root,'est-gui/dist'),outside=path.join(fixture.root,'outside');
    try {
        fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'keep');
        fs.symlinkSync(outside,dist);
        await expect(fixture.runGui(command,args,{spawnTool:async()=>0})).rejects.toThrow(/symlink|unsafe/i);
        fs.unlinkSync(dist);fs.mkdirSync(dist);fs.symlinkSync(outside,path.join(dist,target));
        await expect(fixture.runGui(command,args,{spawnTool:async()=>0})).rejects.toThrow(/symlink|unsafe|exist|overwrite/i);
        expect(fs.readdirSync(outside)).toEqual(['keep']);
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
