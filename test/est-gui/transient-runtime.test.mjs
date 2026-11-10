import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {checkoutPaths}=createRequire(import.meta.url)('../../common/transient-paths.cjs');
it('Electron configures disposable paths before readiness without moving durable profile/home data',async()=>{
    expect(fs.existsSync(path.resolve(import.meta.dirname,'../../est-gui/src/main/lib/transient.js'))).toBe(true);
    const {configureTransientRuntime}=await import('../../est-gui/src/main/lib/transient.js');
    const calls=[],app={isPackaged:true,getPath:name=>name==='exe'?process.execPath:'/persistent/'+name,
        setPath:(name,value)=>calls.push([name,value]),setAppLogsPath:value=>calls.push(['logs',value])};
    configureTransientRuntime(app);
    for(const name of ['temp','sessionData','crashDumps','logs']) {
        const value=calls.find(call=>call[0]===name)?.[1];expect(value?.startsWith('/tmp/effectstreamer/')).toBe(true);expect(fs.statSync(value).isDirectory()).toBe(true);
    }
    expect(calls.some(call=>['userData','home','appData'].includes(call[0]))).toBe(false);
});
it('GUI instances from different installations cannot share the same persistent profile concurrently',async()=>{
    const {configureTransientRuntime}=await import('../../est-gui/src/main/lib/transient.js'),home=checkoutPaths().temporaryDirectory('est-gui','profile-');
    let release;const app={isPackaged:true,getPath:name=>name==='exe'?process.execPath:home,
        setPath:()=>{},setAppLogsPath:()=>{},once:(event,listener)=>{if(event==='will-quit')release=listener;}};
    try {
        configureTransientRuntime(app);
        expect(()=>configureTransientRuntime({...app,getPath:name=>name==='exe'?'/other/install/effectstreamer':home,once:()=>{}})).toThrow(/lock|instance/i);
    } finally {release?.();fs.rmSync(home,{recursive:true,force:true});}
});
