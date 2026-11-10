import { it, expect } from "vitest";
import fs from "node:fs/promises";
import vm from "node:vm";
import { WavAccumulator } from "../../est-gui/src/renderer/windowMain/audio/wav-worker.js";
import { MemoryRecordings } from "../../est-gui/src/renderer/windowMain/audio/memory-recordings.js";
import { PcmRecorder } from "../../est-gui/src/renderer/windowMain/audio/pcm-recorder.js";

async function wav(blob) {
    const bytes=new DataView(await blob.arrayBuffer());
    return {bytes,text:(offset,length)=>String.fromCharCode(...new Uint8Array(bytes.buffer,offset,length)),samples:Array.from({length:(bytes.byteLength-44)/2},(_,index)=>bytes.getInt16(44+2*index,true))};
}
it('separate input signals become distinct 48 kHz mono S16LE WAVs with clipped PCM',async()=>{
    const writer=new WavAccumulator({maxBytes:1000});writer.append('microphone',new Float32Array([-2,-1,0,.5,1,2]));writer.append('headphones',new Float32Array([.25,.25]));
    const files=writer.finish();expect(Object.keys(files)).toEqual(['microphone','headphones']);
    const mic=await wav(files.microphone),play=await wav(files.headphones);
    expect(mic.text(0,4)).toBe('RIFF');expect(mic.text(8,8)).toBe('WAVEfmt ');expect(mic.text(36,4)).toBe('data');
    expect(mic.bytes.getUint32(4,true)).toBe(mic.bytes.byteLength-8);expect(mic.bytes.getUint16(20,true)).toBe(1);expect(mic.bytes.getUint16(22,true)).toBe(1);
    expect(mic.bytes.getUint32(24,true)).toBe(48000);expect(mic.bytes.getUint16(34,true)).toBe(16);
    expect(mic.samples).toEqual([-32768,-32768,0,16384,32767,32767]);expect(play.samples).toEqual([8192,8192]);
});
it('the shared byte bound fails explicitly but preserves already captured partial audio',async()=>{
    const writer=new WavAccumulator({maxBytes:96});writer.append('microphone',new Float32Array([.5,.5]));
    expect(()=>writer.append('headphones',new Float32Array(3))).toThrow(/limit/);
    expect((await wav(writer.finish().microphone)).samples).toEqual([16384,16384]);
});
it('the recording worklet emits PCM and stop flushes only its actual partial buffer without monitoring',async()=>{
    let Processor;const messages=[];
    class Base{constructor(){this.port={postMessage:message=>messages.push(message)};}}
    vm.runInNewContext(await fs.readFile(new URL('../../est-gui/src/renderer/windowMain/audio-worklets/record-processor.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,registerProcessor:(_name,value)=>{Processor=value;},Float32Array});
    const recorder=new Processor(),output=new Float32Array(4).fill(1);
    recorder.process([[new Float32Array([.1,.2,.3,.4])]],[[output]]);expect([...output]).toEqual([0,0,0,0]);
    recorder.port.onmessage({data:{type:'stop'}});
    expect(messages.map(message=>message.type)).toEqual(['pcm','stopped']);expect(messages[0].pcm.length).toBe(4);
    expect(Object.keys(messages[0])).toEqual(['type','pcm']);
});
const scope={sessionId:'session-1',participantId:'person-1',attemptId:'attempt-1'};
async function retained() {
    const writer=new WavAccumulator({maxBytes:1000});writer.append('microphone',new Float32Array([.5]));writer.append('headphones',new Float32Array([.25]));
    const store=new MemoryRecordings({maxBytes:1000});const manifests=await store.retain({scope,files:writer.finish(),status:'interrupted'});return {store,manifests};
}
it('in-memory files keep stable manifests and survive offline collection until a matching receipt',async()=>{
    const {store,manifests}=await retained();expect(manifests).toHaveLength(2);
    expect(Object.keys(manifests[0]).sort()).toEqual(['recordingId','sessionId','participantId','attemptId','track','filename','source','contentType','byteLength','sha256','status'].sort());
    await expect(store.collect({...scope,recordingIds:manifests.map(value=>value.recordingId)},{request:async()=>{throw new Error('offline');},maxRetries:0})).rejects.toThrow('offline');
    expect((await store.readChunk(manifests[0].recordingId,0,4)).length).toBe(4);
    expect(()=>store.release({recordingId:manifests[0].recordingId,sha256:'bad',stored:true})).toThrow(/receipt/i);
    store.release({recordingId:manifests[0].recordingId,sha256:manifests[0].sha256,stored:true});
    await expect(store.readChunk(manifests[0].recordingId,0,4)).rejects.toThrow(/unknown/i);
    expect((await store.readChunk(manifests[1].recordingId,0,4)).length).toBe(4);
});
it('retention enforces the total bound across pending attempts without discarding earlier bytes',async()=>{
    const {store,manifests}=await retained();store.maxBytes=100;
    await expect(store.retain({scope:{...scope,attemptId:'attempt-2'},files:{microphone:new Blob([new Uint8Array(60)]),headphones:new Blob([new Uint8Array(60)])},status:'interrupted'})).rejects.toThrow(/limit/);
    expect((await store.readChunk(manifests[0].recordingId,0,4)).length).toBe(4);
});
it('duplicate concurrent collection requests reconcile the same receipt without deleting another file',async()=>{
    const {store,manifests}=await retained(),manifest=manifests[0];
    const command={...scope,recordingIds:[manifest.recordingId]},options={request:async(_method,url,body)=>url.endsWith('/complete')?{recordingId:manifest.recordingId,sha256:manifest.sha256,stored:true}:{uploadId:manifest.recordingId,nextByteOffset:body.byteLength}};
    await Promise.all([store.collect(command,options),store.collect(command,options)]);
    expect(store.pending.size).toBe(1);expect(store.pending.has(manifests[1].recordingId)).toBe(true);
});
it('unsupported context rates and empty/cancelled starts cannot silently label data 48 kHz',async()=>{
    const recorder=new PcmRecorder({context:{sampleRate:44100},maxBytes:1000});
    await expect(recorder.start({microphone:{},playback:{}})).rejects.toThrow(/48000|48 kHz/);
    expect(await recorder.stop()).toBeNull();
    const empty=new PcmRecorder({context:{sampleRate:48000},maxBytes:1000});
    await expect(empty.start({})).rejects.toThrow(/streams|tracks/i);expect(await empty.stop()).toBeNull();
});
it('stopping while a worklet module loads cannot reconnect recording nodes afterward',async()=>{
    let finishModule, moduleRequested;
    const requested=new Promise(resolve=>{moduleRequested=resolve;});
    const context={sampleRate:48000,state:'running',resume:async()=>{},audioWorklet:{addModule:()=>{moduleRequested();return new Promise(resolve=>{finishModule=resolve;});}},createMediaStreamSource:()=>({connect(){},disconnect(){}}),destination:{}};
    class Worker {
        postMessage(message){queueMicrotask(()=>this.onmessage({data:message.type==='finish'?{id:message.id,files:new WavAccumulator({maxBytes:1000}).finish()}:{id:message.id,ok:true}}));}
        terminate(){}
    }
    class Node {constructor(){this.port={postMessage(){},close(){}};}connect(){}disconnect(){}}
    const recorder=new PcmRecorder({context,maxBytes:1000,Worker,AudioWorkletNode:Node});
    const streams={microphone:{getAudioTracks:()=>[{}]},playback:{getAudioTracks:()=>[{}]}};
    const starting=recorder.start(streams);await requested;await recorder.stop();finishModule();
    try {await expect(starting).rejects.toThrow(/cancelled/);expect(recorder.nodes).toEqual([]);}
    finally {recorder.cleanup();}
});
