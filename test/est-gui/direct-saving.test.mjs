import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
vi.mock('electron',()=>({app:{getPath:()=>'/unused'}}));
import {saveAudioDeviceIds} from '../../est-gui/src/main/lib/config.js';
import {loadLocalEnrollment} from '../../est-gui/src/main/lib/enrollment.js';
import {NativeAudioRuntime} from '../../est-gui/src/main/audio/native.js';
const require=createRequire(import.meta.url),{checkoutPaths}=require('../../common/transient-paths.cjs');
it('GUI configuration, enrollment and pending manifests save without publication renames',async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','direct-');
    const rename=vi.spyOn(fs.promises,'rename').mockImplementation(()=>{throw new Error('rename forbidden');});
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({participantId:'person-a',reconnectToken:'test-token'})});
    try {
        const config=path.join(root,'config.json');fs.writeFileSync(config,JSON.stringify(require('../../est-gui/est-gui.config.example.json')));
        await saveAudioDeviceIds(config,{source:'input',sink:'output'});
        expect(JSON.parse(fs.readFileSync(config)).audio.devices.source).toBe('input');
        await loadLocalEnrollment({url:'http://localhost',identity:'client-a',ipAddress:'127.0.0.1',operatingSystem:'linux',credentialsPath:path.join(root,'enrollment.json')});
        const runtime=new NativeAudioRuntime({config:{audio:{backend:'native'}},executable:'unused',recordingRoot:root});
        await runtime.savePending();
        expect(JSON.parse(fs.readFileSync(path.join(root,'pending-recordings.json')))).toEqual([]);
        expect(fs.readdirSync(root).sort()).toEqual(['config.json','enrollment.json','pending-recordings.json']);
    } finally {rename.mockRestore();fetch.mockRestore();fs.rmSync(root,{recursive:true,force:true});}
});
it('overlapping pending recording saves from separate runtimes cannot tear their JSON',async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','pending-concurrent-'),open=fs.promises.open.bind(fs.promises);
    let started,release,opens=0;const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const spy=vi.spyOn(fs.promises,'open').mockImplementation(async(...args)=>{
        const handle=await open(...args);opens++;
        if(opens===1){const write=handle.writeFile.bind(handle);handle.writeFile=async contents=>{started();await gate;return write(contents);};}return handle;
    });
    const options={config:{audio:{backend:'native'}},executable:'unused',recordingRoot:root};
    const first=new NativeAudioRuntime(options),second=new NativeAudioRuntime(options);
    first.pending.set('test',{manifest:{data:'x'.repeat(10000)}});
    const a=first.savePending();await entered;const b=second.savePending();
    try {const premature=await Promise.race([b.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),200))]);expect(premature).toBe(false);expect(opens).toBe(1);}
    finally {release();await Promise.all([a,b]);spy.mockRestore();}
    try {expect(JSON.parse(fs.readFileSync(path.join(root,'pending-recordings.json')))).toEqual([]);}
    finally {fs.rmSync(root,{recursive:true,force:true});}
});
