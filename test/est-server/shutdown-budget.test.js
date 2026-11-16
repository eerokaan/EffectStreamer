const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setImmediate}=require('node:timers/promises');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {MediaWorker}=require('../../est-server/src/media/MediaWorker.js');
const {RemoteMediaAdapter}=require('../../est-server/src/media/RemoteMediaAdapter.js');
const {PortAllocator}=require('../../est-server/src/media/PortAllocator.js');
const {localConfig}=require('./fixtures/config.js');

test('recording budget covers sequential uplink/downlink shutdown and adapter playback drain',async t=>{
    t.mock.timers.enable({apis:['setTimeout','Date'],now:599500});
    const config=normalizeConfig(localConfig()),worker=new MediaWorker({config:config.remote});
    const phases=[];
    // Only native child processes are substituted; the worker and adapter stop
    // orchestration remain real. Each phase succeeds within its seven-second bound.
    for(const connectionId of ['uplink','downlink']) for(const participantId of ['a','b']) {
        worker.children.set(participantId+':'+connectionId,{connectionId,participantId,core:{async stop(){
            phases.push(connectionId);
            await new Promise(resolve=>setTimeout(resolve,6000));
        }}});
    }
    const allocator=new PortAllocator([32000,32099]),commands=[];
    const adapter=new RemoteMediaAdapter({config:config.remote,allocator,clientRegistry:{emitToSocket(_socket,_event,command){commands.push({...command,at:Date.now()});}}});
    adapter.session={clientsData:new Map([['a',{socketId:'a'}],['b',{socketId:'b'}]])};
    adapter.attempt={contextKey:'stop-budget'};adapter.owner='stop-budget';allocator.lease(adapter.owner,6);
    adapter.child={connected:true};adapter.exited=Promise.resolve();
    // The IPC boundary dispatches to the real in-process worker for this test.
    adapter.request=method=>method==='stop'?worker.stop():worker.dispose();
    const stopping=adapter.stop({reason:'completed'});
    await setImmediate();
    assert.deepEqual(phases,['uplink','uplink']);
    t.mock.timers.tick(6000);await setImmediate();
    assert.deepEqual(phases,['uplink','uplink','downlink','downlink']);
    t.mock.timers.tick(6000);await setImmediate();
    assert.equal(commands.filter(command=>command.type==='stopCore').length,0);
    t.mock.timers.tick(250);await stopping;
    const stopped=commands.filter(command=>command.type==='stopCore');
    assert.equal(stopped.length,2);assert.equal(stopped[0].at,611750);
    const wavBytes=2*(611750*96+44); // Two mono 48 kHz, 16-bit tracks.
    assert.equal(wavBytes,117456088);
    assert.ok(config.recordings.maxBytesPerParticipant>=wavBytes,'supported successful shutdown must not exceed the recording budget');
});

test('recording budget also covers actual stop/dispose IPC deadlines and forced worker exit',async t=>{
    t.mock.timers.enable({apis:['setTimeout','Date'],now:600000});
    const config=normalizeConfig(localConfig()),commands=[];
    const adapter=new RemoteMediaAdapter({config:config.remote,allocator:new PortAllocator([32100,32199]),clientRegistry:{emitToSocket(_socket,_event,command){commands.push({...command,at:Date.now()});}}});
    adapter.session={clientsData:new Map([['a',{socketId:'a'}],['b',{socketId:'b'}]])};
    adapter.attempt={contextKey:'stop-timeouts'};
    let exited;
    adapter.exited=new Promise(resolve=>{exited=resolve;});
    // A nonresponsive external worker: use the real request timers and cleanup.
    adapter.child={connected:true,send(){},kill(){this.connected=false;exited();}};
    const stopped=assert.rejects(adapter.stop({reason:'completed'}),/Worker stop timed out/);
    t.mock.timers.tick(15000);await setImmediate();
    assert.equal(commands.filter(command=>command.type==='stopCore').length,0);
    t.mock.timers.tick(121000);await setImmediate();
    assert.equal(adapter.child.connected,true);
    t.mock.timers.tick(2000);await setImmediate();
    t.mock.timers.tick(250);await stopped;
    const command=commands.find(command=>command.type==='stopCore');
    assert.equal(command.at,738250);assert.equal(command.reason,'interrupted');
    assert.ok(config.recordings.maxBytesPerParticipant>=141744088,'the full bounded failure path must fit the byte budget');
    assert.equal(adapter.pending.size,0);
});
