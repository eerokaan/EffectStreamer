import { it, expect } from "vitest";
import { BrowserDevices } from "../src/renderer/windowMain/audio/browser-devices.js";
import { BrowserAudioSession } from "../src/renderer/windowMain/audio/browser-session.js";

function track() { return { kind: "audio", readyState: "live", enabled: true, stopped: false, stop() {this.stopped=true;this.readyState="ended";}, getSettings() {return { echoCancellation: false };}, addEventListener() {} }; }
function stream(value=track()) { return { getAudioTracks:()=>[value],getTracks:()=>[value] }; }
function audio({ routing=true, blocked=false, stalled=false }={}) {
    return { sinkId:"",src:"",srcObject:null,onended:null,onerror:null,played:0,
        ...(routing?{async setSinkId(id) {if(id==='gone')throw new Error('Output removed');this.sinkId=id;}}:{}),
        async play() {if(blocked)throw new Error('Autoplay denied');this.played++;if(this.src&&!stalled)queueMicrotask(()=>this.onended?.());},pause(){},load(){} };
}
function devices(options={}) {
    const captures=[],constraints=[];const playback=audio(options);const selections=[];
    const mediaDevices={
        async getUserMedia(value) {if(options.denied)throw new Error('Microphone permission denied');const result=stream();captures.push(result);constraints.push(value);return result;},
        async enumerateDevices(){return [{kind:'audioinput',deviceId:'mic-1',label:'Microphone'},{kind:'audiooutput',deviceId:'speaker-1',label:'Headphones'}];},
        ...(options.firefox?{async selectAudioOutput(){selections.push('permission');return {deviceId:'permitted',label:'Permitted output'};}}:{}),
        addEventListener(){},removeEventListener(){}
    };
    class Context {
        constructor(){this.sampleRate=48000;}
        createMediaStreamSource(){return {connect(node){if(node===this.destination)throw new Error('Microphone audibly monitored');},disconnect(){}};}
        createAnalyser(){return {fftSize:32,getFloatTimeDomainData(array){array.fill(.25);}};}
        async resume(){}async close(){}
    }
    const value=new BrowserDevices({mediaDevices,playback,AudioContext:Context,testAsset:'/audio/P501.wav',testDurationMs:2,testTimeoutMs:20});
    return {value,playback,captures,constraints,selections};
}
it('preselects logical defaults without relabeling the first device as the default',async()=>{
    const f=devices();const found=await f.value.list();
    expect(found.selection).toEqual({sourceId:'default',sinkId:'default'});
    expect(found.inputs.map(value=>value.id)).toEqual(['default','mic-1']);
    expect(found.outputs.map(value=>value.id)).toEqual(['default','speaker-1']);
    expect(f.captures[0].getTracks()[0].stopped).toBe(true);
});
it('routes a concrete output and requests Firefox output permission explicitly',async()=>{
    const f=devices({firefox:true});expect((await f.value.chooseOutput()).id).toBe('permitted');
    await f.value.selectOutput(f.playback,'speaker-1');expect(f.playback.sinkId).toBe('speaker-1');
    await f.value.selectOutput(f.playback,'default');expect(f.playback.sinkId).toBe('');
    expect(f.selections).toEqual(['permission']);
    await expect(f.value.selectOutput(f.playback,'gone')).rejects.toThrow('removed');
});
it('honestly offers only default output without sink routing and refuses a concrete fallback',async()=>{
    const f=devices({routing:false});expect((await f.value.list()).outputs.map(value=>value.id)).toEqual(['default']);
    await f.value.selectOutput(f.playback,'default');
    await expect(f.value.selectOutput(f.playback,'speaker-1')).rejects.toThrow(/default|routing/i);
});
it('P.501 setup checks live input without monitoring and must be retested after device changes',async()=>{
    const f=devices();const peaks=[];const selection={sourceId:'default',sinkId:'default'};
    const result=await f.value.test(selection,{onLevel:peak=>peaks.push(peak)});
    expect(result.inputUsable).toBe(true);expect(result.playbackComplete).toBe(true);expect(result.peak).toBeGreaterThan(0);
    expect(peaks.some(peak=>peak>0)).toBe(true);expect(f.playback.played).toBe(1);
    expect(f.constraints[0].audio).toMatchObject({echoCancellation:false,noiseSuppression:false,autoGainControl:false});
    expect(f.captures[0].getTracks()[0].stopped).toBe(true);
    await f.value.save(selection);
    f.value.invalidate();await expect(f.value.save(selection)).rejects.toThrow(/test/i);
    f.value.setActive(true);await expect(f.value.test(selection)).rejects.toThrow(/active/i);
});
it('permission denial and rejected autoplay never certify a successful setup',async()=>{
    await expect(devices({denied:true}).value.list()).rejects.toThrow('permission denied');
    const f=devices({blocked:true});await expect(f.value.test({sourceId:'default',sinkId:'default'})).rejects.toThrow('Autoplay');
    await expect(f.value.save({sourceId:'default',sinkId:'default'})).rejects.toThrow(/test/i);
    expect(f.captures.every(value=>value.getTracks()[0].stopped)).toBe(true);
});
it('a stalled sample has a finite setup deadline and releases its microphone',async()=>{
    const f=devices({stalled:true});await expect(f.value.test({sourceId:'default',sinkId:'default'})).rejects.toThrow(/timed out/);
    expect(f.captures[0].getTracks()[0].stopped).toBe(true);
});

class Peer {
    static instances=[];
    constructor(config){this.config=config;this.connectionState='new';this.transceivers=[];this.candidates=[];Peer.instances.push(this);}
    addTransceiver(value,options){this.transceivers.push({value,...options});return {sender:{replaceTrack:async()=>{}}};}
    async createOffer(){return {type:'offer',sdp:'test-offer'};}
    async setLocalDescription(value){this.localDescription=value;this.onicecandidate?.({candidate:null});}
    async setRemoteDescription(value){this.remoteDescription=value;this.connectionState='connected';if(this.transceivers[0].direction==='recvonly')this.ontrack?.({streams:[stream()]});this.onconnectionstatechange?.();}
    async addIceCandidate(value){this.candidates.push(value);}
    close(){this.connectionState='closed';}
}
const scope={sessionId:'session-1',participantId:'person-1',attemptId:'attempt-1'};
it('uses two unidirectional peers and one authorized playback element, preserving original recording taps',async()=>{
    Peer.instances=[];const f=devices(),messages=[];
    const session=new BrowserAudioSession({devices:f.value,RTCPeerConnection:Peer,MediaStream:class {constructor(tracks){return stream(tracks[0]);}}});
    await session.prepare({scope,generation:'generation-1',iceServers:[],signal:async value=>{messages.push(value);return value.type==='offer'?{type:'answer',sdp:'answer'}:null;}});
    expect(Peer.instances.map(peer=>peer.transceivers[0].direction)).toEqual(['sendonly','recvonly']);
    expect(messages.filter(value=>value.type==='offer')).toHaveLength(2);expect(messages.filter(value=>value.type==='ice'&&value.candidate===null)).toHaveLength(2);
    expect(session.streams().microphone).toBe(f.captures[0]);expect(session.streams().playback).toBe(f.playback.srcObject);
    expect(f.playback.played).toBe(1);expect(session.streams().microphone.getTracks()[0].enabled).toBe(false);
    await session.start();expect(session.streams().microphone.getTracks()[0].enabled).toBe(true);
    await expect(f.value.list()).rejects.toThrow(/active/);
    await session.stopCapture();expect(session.streams().microphone.getTracks()[0].enabled).toBe(false);
    await session.stop();expect(Peer.instances.every(peer=>peer.connectionState==='closed')).toBe(true);
});
it('queues early ICE, rejects stale generations, and exposes playback failure',async()=>{
    Peer.instances=[];const f=devices({blocked:true});const session=new BrowserAudioSession({devices:f.value,RTCPeerConnection:Peer});
    await expect(session.prepare({scope,generation:'g-1',iceServers:[],signal:async()=>({type:'answer',sdp:'answer'})})).rejects.toThrow(/Autoplay/);
    expect(Peer.instances.every(peer=>peer.connectionState==='closed')).toBe(true);
    await expect(session.applySignal({...scope,generation:'old',connectionId:'downlink',type:'ice',candidate:null})).rejects.toThrow(/stale|generation/i);
});
it('applies queued ICE only after the matching answer and invalidates an unplugged setup',async()=>{
    Peer.instances=[];const f=devices();const session=new BrowserAudioSession({devices:f.value,RTCPeerConnection:Peer});
    await session.prepare({scope,generation:'early',iceServers:[],signal:async message=>{
        if(message.type==='offer') {
            await session.applySignal({...scope,generation:'early',connectionId:message.connectionId,type:'ice',candidate:null,sdpMLineIndex:0});
            expect(Peer.instances.find(peer=>peer.transceivers[0].direction===(message.connectionId==='uplink'?'sendonly':'recvonly')).candidates).toEqual([]);
            return {type:'answer',sdp:'answer'};
        }
    }});
    expect(Peer.instances.map(peer=>peer.candidates)).toEqual([[null],[null]]);await session.stop();
    const selected={sourceId:'default',sinkId:'default'};await f.value.test(selected);f.value.changed();
    await expect(f.value.save(selected)).rejects.toThrow(/test/i);
});
it('a late cancelled microphone request cannot unlock devices owned by a newer attempt',async()=>{
    const f=devices();let resolveOld;const acquire=f.value.acquire.bind(f.value);let first=true;
    f.value.acquire=()=>{if(first){first=false;return new Promise(resolve=>{resolveOld=resolve;});}return acquire();};
    const old=new BrowserAudioSession({devices:f.value,RTCPeerConnection:Peer});
    const pending=old.prepare({scope,generation:'old',iceServers:[],signal:async()=>({type:'answer',sdp:'answer'})}).catch(error=>error);
    await old.stop();const current=new BrowserAudioSession({devices:f.value,RTCPeerConnection:Peer});
    await current.prepare({scope:{...scope,attemptId:'new-attempt'},generation:'new',iceServers:[],signal:async()=>({type:'answer',sdp:'answer'})});
    resolveOld(stream());expect((await pending).message).toMatch(/cancelled/);
    expect(f.value.active).toBe(true);await current.stop();expect(f.value.active).toBe(false);
});
