import { describe, it, expect } from 'vitest';
import { createRuntime as browserRuntime } from '../src/renderer/windowMain/runtime/browser.js';
import { createRuntime as electronRuntime } from '../src/renderer/windowMain/runtime/electron.js';
import { createSessionClient } from '../src/renderer/windowMain/runtime/session-client.js';

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
    it('both adapters consume identical snapshots and emit identical scoped actions',async()=>{
        const states=[],requests=[];
        for(const target of ['browser','electron']) {
            const socket=transport();const initialization={config:{mode:target==='browser'?'remote':'local',setupRequired:false},credentials:{participantId:'p-1',reconnectToken:'test-token'},url:'https://example.test'};
            const runtime=target==='browser' ? browserRuntime({initialize:async()=>initialization,transportFactory:()=>socket}) : electronRuntime({bridge:{invoke:async()=>initialization},transportFactory:()=>socket});
            runtime.subscribe(value=>states.push(value));await runtime.bootstrap();
            socket.receive('est-event:snapshot',snapshot);
            socket.receive('est-event:snapshot',{...snapshot,revision:1,currentView:'viewWelcome'});
            expect(runtime.snapshot().currentView).toBe('viewPretest');
            await runtime.dispatch('nextView',{currentView:'viewPretest'});
            requests.push(socket.sent[0].message);
            await runtime.dispose();
        }
        expect(states.filter(value=>value.revision===2)).toEqual([snapshot,snapshot]);
        expect(requests.map(({requestId,...request})=>request)).toEqual(Array(2).fill({version:1,sessionId:'s-1',participantId:'p-1',attemptId:null,type:'nextView',payload:{currentView:'viewPretest'}}));
    });
    it('browser bootstrap does not depend on Electron preload',async()=>{
        const runtime=browserRuntime({initialize:async()=>({config:{mode:'remote',setupRequired:true},credentials:{participantId:'p-1',reconnectToken:'secret'},url:'https://example.test'}),transportFactory:()=>transport()});
        expect(globalThis.window).toBeUndefined();
        expect((await runtime.bootstrap()).setupRequired).toBe(true);
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
});
