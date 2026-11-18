import {it,expect,vi} from 'vitest';
const {exposed,listeners,calls}=vi.hoisted(()=>({exposed:{},listeners:new Map(),calls:[]}));
vi.mock('electron',()=>({
    contextBridge:{exposeInMainWorld:(name,value)=>{exposed[name]=value;}},
    ipcRenderer:{
        invoke:async(channel,payload)=>{calls.push({channel,payload});return 'ack';},
        send:(channel,payload)=>{calls.push({channel,payload});},
        on:(channel,listener)=>listeners.set(channel,listener),
        removeListener:(channel,listener)=>{if(listeners.get(channel)===listener)listeners.delete(channel);}
    }
}));
import '../../est-gui/src/preload/index.js';

it.each(['ipc:viewChangeRequest','ipc:pretestSaveRequest','ipc:audioDevicesGet','ipc:audioDevicesSave','ipc:audioDevicesSetupComplete'])('preload refuses obsolete invoke channel %s',channel=>{
    expect(()=>exposed.appApi.ipcRenderer.invoke(channel,{})).toThrow(/Unauthorized/);
});
it('preload refuses the obsolete device-dialog event channel',()=>{
    expect(()=>exposed.appApi.ipcRenderer.on('ipc:audioDevicesOpen',()=>{})).toThrow(/Unauthorized/);
});
it('the Electron renderer can obtain the coordinator language before enrollment', async () => {
    calls.length=0;
    await exposed.appApi.runtime.invoke('configuration');
    expect(calls).toEqual([{channel:'ipc:runtime',payload:{operation:'configuration',payload:undefined}}]);
});
it('preload retains current runtime, stdio and store controls',async()=>{
    calls.length=0;
    const api=exposed.appApi;
    expect(await api.runtime.invoke('devices.save',{source:'input',sink:'output'})).toBe('ack');
    for(const channel of ['ipc:audioControlResponse','ipc:audioFailure'])expect(await api.ipcRenderer.invoke(channel,{success:true})).toBe('ack');
    const received=[];
    for(const channel of ['ipc:storeGetValueRequest','ipc:storeSetValueRequest','ipc:storeResetRequest','ipc:audioControlRequest']) {
        const off=api.ipcRenderer.on(channel,(_event,data)=>received.push(data));
        listeners.get(channel)({},channel);off();
    }
    for(const channel of ['ipc:storeGetValueResponse','ipc:storeSetValueResponse','ipc:storeResetResponse'])api.ipcRenderer.send(channel,{value:1});
    expect(received).toEqual(['ipc:storeGetValueRequest','ipc:storeSetValueRequest','ipc:storeResetRequest','ipc:audioControlRequest']);
    expect(calls).toEqual([
        {channel:'ipc:runtime',payload:{operation:'devices.save',payload:{source:'input',sink:'output'}}},
        {channel:'ipc:audioControlResponse',payload:{success:true}},{channel:'ipc:audioFailure',payload:{success:true}},
        ...['ipc:storeGetValueResponse','ipc:storeSetValueResponse','ipc:storeResetResponse'].map(channel=>({channel,payload:{value:1}}))
    ]);
});
