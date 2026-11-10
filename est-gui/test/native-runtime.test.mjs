import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { NativeAudioRuntime, coreArguments } from "../src/main/audio/native.js";
import {checkoutPaths} from '../../common/transient-paths.cjs';

const scope={sessionId:'session-1',participantId:'person-a',attemptId:'attempt-1'};
const condition={nativeDelay:30,echoDelay:80,nativeGain:0.5,echoGain:0.1,packetlossType:'random',packetlossRatio:0.2};
it('native arguments use the selected OS backend, native IDs, endpoints and attempt directory',()=>{
    for(const [platform,backend] of [['linux','alsa'],['win32','wasapi2']]) {
        const args=coreArguments({platform,scope,component:'sender',devices:{source:'native-source',sink:'native-output'},condition,peer:{ipAddress:'192.0.2.10',port:12000},ports:{listen:12001,echo:12002,record:12003},directory:'/recordings/session-1/attempt-1/person-a'});
        expect(args[args.indexOf('--device-type')+1]).toBe(backend);
        expect(args[args.indexOf('--device-id')+1]).toBe('native-source');
        expect(args[args.indexOf('--peer-port')+1]).toBe('12000');
        expect(args[args.indexOf('--recording-dir')+1]).toBe('/recordings/session-1/attempt-1/person-a');
        expect(args).toContain('--control');expect(args).not.toContain('stdio');
    }
});
it('native setup lists backend defaults and cannot reuse historical browser IDs',async()=>{
    const runtime=new NativeAudioRuntime({config:{client:{audioDevices:{source:'browser-id',sink:'other'}}},platform:'linux',executable:'unused',recordingRoot:'/unused',testAsset:'/packaged/P501.wav',runUtility:async()=>({inputs:[{id:'default',label:'Default microphone'}],outputs:[{id:'default',label:'Default output'}]})});
    expect((await runtime.listDevices()).selection).toEqual({sourceId:'default',sinkId:'default'});
});
it('a receipt cannot delete a pending file unless both ID and digest match',async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','est-native-');
    try {
        const runtime=new NativeAudioRuntime({config:{audio:{backend:'native'}},platform:'linux',executable:'unused',recordingRoot:root,testAsset:'/packaged/P501.wav'});
        const directory=path.join(root,scope.sessionId,scope.attemptId,scope.participantId);await fs.mkdir(directory,{recursive:true});
        await fs.writeFile(path.join(directory,'microphone.wav'),Buffer.alloc(48));await fs.writeFile(path.join(directory,'headphones.wav'),Buffer.alloc(48));
        const manifests=await runtime.recordings(scope,{status:'interrupted'});
        expect(manifests).toHaveLength(2);
        await expect(runtime.release({...manifests[0],sha256:'bad',stored:true})).rejects.toThrow(/receipt/i);
        expect((await fs.stat(path.join(directory,'microphone.wav'))).size).toBe(48);
        await runtime.release({recordingId:manifests[0].recordingId,sha256:manifests[0].sha256,stored:true});
        await expect(fs.stat(path.join(directory,'microphone.wav'))).rejects.toThrow();
        expect((await fs.stat(path.join(directory,'headphones.wav'))).size).toBe(48);
    } finally {await fs.rm(root,{recursive:true,force:true});}
});
