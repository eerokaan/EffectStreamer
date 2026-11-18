import { describe, it, expect } from 'vitest';
import { createRuntime as browserRuntime } from '../../est-gui/src/renderer/windowMain/runtime/browser.js';
import { createRuntime as electronRuntime } from '../../est-gui/src/renderer/windowMain/runtime/electron.js';
import { createSessionClient } from '../../est-gui/src/renderer/windowMain/runtime/session-client.js';
import { BrowserDevices } from '../../est-gui/src/renderer/windowMain/audio/browser-devices.js';

function transport() {
    const listeners=new Map();const sent=[];
    return {
        sent,
        on(name,listener) {if(!listeners.has(name)) listeners.set(name,new Set());listeners.get(name).add(listener);},
        off(name,listener) {listeners.get(name)?.delete(listener);},
        emit(name,message,ack) {sent.push({name,message});ack?.({ok:true,requestId:message.requestId});},
        receive(name,value) {for(const listener of listeners.get(name)||[]) listener(value);},
        disconnect() {}
    };
}
const snapshot={revision:2,participantId:'p-1',sessionId:'s-1',role:'a',phase:'experiment',currentView:'viewPretest',setupRequired:false,setupComplete:false,attemptId:null,viewData:{pretestForm:[{name:'age'}]},outcome:null};
describe('shared participant runtime',()=>{
    it('only current media commands can prepare or stop audio',()=>{
        const socket=transport(),commands=[];
        const client=createSessionClient({transport:socket,participantId:'p-1',onCommand:value=>commands.push(value)});
        socket.receive('est-event:coreStartRequest',{component:'sender',attemptId:'old'});
        socket.receive('est-event:coreStopRequest',{attemptId:'old'});
        expect(commands).toEqual([]);
        socket.receive('est-event:mediaCommand',{type:'prepareCore',component:'sender',attemptId:'current'});
        socket.receive('est-event:mediaCommand',{type:'stopCore',attemptId:'current'});
        expect(commands).toEqual([{type:'prepareCore',component:'sender',attemptId:'current'},{type:'stopCore',attemptId:'current'}]);
        client.dispose();
    });
    it('both adapters consume identical snapshots and emit identical scoped actions',async()=>{
        const states=[],requests=[],languages=[];
        for(const target of ['browser','electron']) {
            const socket=transport();const initialization={config:{mode:target==='browser'?'remote':'local',setupRequired:false,sessionLanguage:'de'},credentials:{participantId:'p-1',reconnectToken:'test-token'},url:'https://example.test'};
            const runtime=target==='browser' ? browserRuntime({initialize:async()=>initialization,transportFactory:()=>socket}) : electronRuntime({bridge:{invoke:async operation=>operation==='configuration'?initialization.config:initialization},transportFactory:()=>socket});
            runtime.subscribeConfiguration(value=>languages.push(value.sessionLanguage));
            runtime.subscribe(value=>states.push(value));await runtime.bootstrap();
            socket.receive('est-event:snapshot',snapshot);
            socket.receive('est-event:snapshot',{...snapshot,revision:1,currentView:'viewWelcome'});
            expect(runtime.snapshot().currentView).toBe('viewPretest');
            await runtime.dispatch('nextView',{currentView:'viewPretest'});
            requests.push(socket.sent[0].message);
            await runtime.dispose();
        }
        expect(states.filter(value=>value.revision===2)).toEqual([snapshot,snapshot]);
        expect(languages).toEqual(['de','de']);
        expect(requests.map(({requestId,...request})=>request)).toEqual(Array(2).fill({version:1,sessionId:'s-1',participantId:'p-1',attemptId:null,type:'nextView',payload:{currentView:'viewPretest'}}));
    });
    it('browser bootstrap does not depend on Electron preload',async()=>{
        const runtime=browserRuntime({initialize:async()=>({config:{mode:'remote',setupRequired:true,sessionLanguage:'en'},credentials:{participantId:'p-1',reconnectToken:'secret'},url:'https://example.test'}),transportFactory:()=>transport()});
        expect(globalThis.window).toBeUndefined();
        expect((await runtime.bootstrap()).setupRequired).toBe(true);
        expect(runtime.devices.setupSample).toBe('/audio/P501_C_english_f1_FB_48k.wav');
        await runtime.dispose();
    });
    it('session client rejects wrong-participant snapshots and detaches listeners',async()=>{
        const socket=transport(),states=[];
        const client=createSessionClient({transport:socket,participantId:'p-1',onSnapshot:value=>states.push(value)});
        socket.receive('est-event:snapshot',{...snapshot,participantId:'other'});
        expect(states).toEqual([]);socket.receive('est-event:snapshot',snapshot);expect(states).toEqual([snapshot]);
        client.dispose();socket.receive('est-event:snapshot',{...snapshot,revision:3});expect(states).toHaveLength(1);
    });
    it('signals use their dedicated authenticated event and preserve answer acknowledgements',async()=>{
        const socket=transport();let signal;
        socket.emit=(event,message,ack)=>{signal={event,message};ack({ok:true,requestId:message.requestId,signal:{type:'answer',sdp:'answer'}});};
        const client=createSessionClient({transport:socket,participantId:'p-1'});socket.receive('est-event:snapshot',snapshot);
        expect(await client.dispatch('signal',{connectionId:'uplink',generation:'g-1',type:'offer',sdp:'offer'})).toEqual({type:'answer',sdp:'answer'});
        expect(signal.event).toBe('est-event:signal');client.dispose();
    });
    it('reconciles reconnect when Socket.IO delivers its buffered snapshot before connect',()=>{
        const socket=transport(),commands=[];
        const client=createSessionClient({transport:socket,participantId:'p-1',onCommand:command=>commands.push(command)});
        socket.receive('est-event:snapshot',snapshot);commands.length=0;socket.receive('connect');
        expect(commands).toEqual([{type:'reconnected',snapshot}]);client.dispose();
    });
    it('a fresh browser invalidates persisted setup even between attempts',async()=>{
        const socket=transport(),devices=new BrowserDevices({mediaDevices:{}});
        const runtime=browserRuntime({devices,initialize:async()=>({config:{mode:'remote',setupRequired:true,sessionLanguage:'de'},credentials:{participantId:'p-1'},url:'https://example.test'}),transportFactory:()=>socket});
        await runtime.bootstrap();socket.receive('est-event:snapshot',{...snapshot,setupRequired:true,setupComplete:true});
        expect(socket.sent.map(value=>value.message.type)).toContain('setupInvalidated');
        await runtime.dispose();
    });
    it('device invalidation between attempts revokes approval but a valid reconnect does not',async()=>{
        const socket=transport(),devices=new BrowserDevices({mediaDevices:{}});
        devices.tested={sourceId:'default',sinkId:'default'};devices.context={state:'running',sampleRate:48000,async close(){}};
        const runtime=browserRuntime({devices,initialize:async()=>({config:{mode:'remote',setupRequired:true,sessionLanguage:'de'},credentials:{participantId:'p-1'},url:'https://example.test'}),transportFactory:()=>socket});
        await runtime.bootstrap();socket.receive('est-event:snapshot',{...snapshot,setupRequired:true,setupComplete:true});
        socket.receive('connect');expect(socket.sent).toEqual([]);
        devices.changed();expect(socket.sent.map(value=>value.message.type)).toEqual(['setupInvalidated']);
        await runtime.dispose();
    });
});
