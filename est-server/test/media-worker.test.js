const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const dgram = require("node:dgram");
const { once } = require("node:events");
const { startCore } = require("../../est-common/core-process.cjs");
const { PortAllocator } = require("../src/media/PortAllocator.js");
const { MediaWorker } = require("../src/media/MediaWorker.js");
const { RemoteMediaAdapter } = require("../src/media/RemoteMediaAdapter.js");

const executable = process.env.EST_CORE_EXECUTABLE || path.resolve(__dirname, "../../est-core/.build/linux/est-core");
const peerExecutable = path.join(path.dirname(executable), "webrtc-peer");
function settings() { return { coreExecutable: executable, icePortRange: [46000, 46999], iceServers: [], playbackDrainMs: 10, startupTimeoutMs: 6000, stopTimeoutMs: 7000, jitterMs: 20, opusBitrate: 128000, rtpFrames: 128 }; }
function scope(id) { return { sessionId: "session-" + id, attemptId: "attempt-" + id, participants: ["a-" + id, "b-" + id] }; }
async function fixture(t, id, allocator = new PortAllocator([32000, 32999])) {
    const owner = scope(id), worker = new MediaWorker({ config: settings() });
    const endpoints = allocator.lease(owner.sessionId, 6);
    t.after(async () => { await worker.dispose(); allocator.release(owner.sessionId); });
    await worker.prepare({ ...owner, condition: { nativeGain: 1, echoGain: 0.1 }, endpoints });
    return { worker, owner, endpoints };
}
async function peers(t, worker, owner) {
    const handles = [], errors = [];
    for (const participantId of owner.participants) {
        for (const connectionId of ["uplink", "downlink"]) {
            const peer = await startCore({ executable: peerExecutable, args: [connectionId === "uplink" ? "sender" : "receiver"], timeoutMs: 4000 });
            handles.push(peer); t.after(() => peer.stop({ timeoutMs: 1500 }));
            const message = { sessionId: owner.sessionId, attemptId: owner.attemptId, generation: worker.generation, connectionId };
            peer.on("ice-candidate", candidate => { void worker.signal(participantId, { ...message, type: "ice", ...candidate }).catch(error => errors.push(error.message)); });
            worker.on("signal", value => { if (value.participantId === participantId && value.connectionId === connectionId) void peer.request("webrtc.ice", value).catch(error => errors.push(error.message)); });
            const offer = await peer.request("test.offer", {});
            const answer = await worker.signal(participantId, { ...message, ...offer });
            await peer.request("webrtc.answer", answer);
        }
    }
    return { handles, errors };
}

test("leases stay disjoint, exhaust predictably, and release only their own endpoints", () => {
    const ports = new PortAllocator([32000, 32011]);
    assert.deepEqual(ports.lease("first", 6), [32000, 32001, 32002, 32003, 32004, 32005]);
    assert.deepEqual(ports.lease("second", 6), [32006, 32007, 32008, 32009, 32010, 32011]);
    assert.throws(() => ports.lease("third", 1), /capacity|exhaust/i);
    ports.release("first"); assert.equal(ports.lease("third", 1)[0], 32000);
    assert.deepEqual(ports.lease("second", 6), [32006, 32007, 32008, 32009, 32010, 32011]);
});
test("two workers own four core roles each, private endpoints, and reject foreign/stale signaling", { timeout: 15000 }, async t => {
    const allocator = new PortAllocator([32020, 32099]);
    const a = await fixture(t, "one", allocator), b = await fixture(t, "two", allocator);
    assert.equal(new Set([...a.endpoints, ...b.endpoints]).size, 12);
    assert.equal(a.worker.health().children.length, 4); assert.equal(b.worker.health().children.length, 4);
    const children = a.worker.health().children;
    const argument = (child, flag) => child.args[child.args.indexOf(flag) + 1];
    const sender = children.find(child => child.participantId === "a-one" && child.connectionId === "uplink");
    const ownReceiver = children.find(child => child.participantId === "a-one" && child.connectionId === "downlink");
    const peerReceiver = children.find(child => child.participantId === "b-one" && child.connectionId === "downlink");
    assert.equal(argument(sender, "--peer-port"), argument(peerReceiver, "--listen-port"));
    assert.equal(argument(sender, "--echo-port"), argument(ownReceiver, "--echo-port"));
    assert.ok(children.every(child => argument(child, "--recording") === "none"));
    assert.ok(children.filter(child => child.connectionId === "downlink").every(child => argument(child, "--bind-address") === "127.0.0.1"));
    const message = { sessionId: a.owner.sessionId, attemptId: a.owner.attemptId, generation: a.worker.generation, connectionId: "uplink", type: "ice", candidate: null, sdpMLineIndex: 0 };
    await assert.rejects(a.worker.signal("a-two", message), /participant|owner/);
    await assert.rejects(a.worker.signal("a-one", { ...message, generation: "old" }), /generation|stale/);
    await assert.rejects(a.worker.signal("a-one", { ...message, sessionId: "other" }), /scope/);
    await a.worker.stop(); assert.equal(a.worker.health().children.length, 0); assert.equal(b.worker.health().children.length, 4);
});
test("silent WebRTC preparation reaches media readiness without releasing experiment audio", { timeout: 20000 }, async t => {
    const { worker, owner } = await fixture(t, "silent");
    const { errors } = await peers(t, worker, owner);
    await worker.ready(); assert.equal(worker.health().mediaReady, 4);
    await worker.start(); assert.equal(worker.health().state, "running");
    await worker.stop(); assert.equal(worker.health().children.length, 0); assert.deepEqual(errors, []);
});
test("one crashing core stops only its pair and leaves no children", { timeout: 15000 }, async t => {
    const allocator = new PortAllocator([32100, 32199]);
    const a = await fixture(t, "crash", allocator), b = await fixture(t, "healthy", allocator);
    const failed = once(a.worker, "failure"); process.kill(a.worker.health().children[0].pid, "SIGKILL");
    await failed; await a.worker.dispose();
    assert.equal(a.worker.health().children.length, 0); assert.equal(b.worker.health().children.length, 4);
});
test("bind conflicts fail explicitly and a fresh lease can prepare without leaked children", { timeout: 15000 }, async t => {
    const socket = dgram.createSocket("udp4"); await new Promise(resolve => socket.bind(32200, "127.0.0.1", resolve)); t.after(() => socket.close());
    const worker = new MediaWorker({ config: settings() }); t.after(() => worker.dispose());
    await assert.rejects(worker.prepare({ ...scope("bind"), condition: {}, endpoints: [32200, 32201, 32202, 32203, 32204, 32205] }), /bind|address|resource/i);
    assert.equal(worker.health().children.length, 0);
    await worker.prepare({ ...scope("bind"), condition: {}, endpoints: [32206, 32207, 32208, 32209, 32210, 32211] });
    assert.equal(worker.health().children.length, 4);
});
test("no-media readiness has a finite timeout and stop during negotiation is bounded", { timeout: 15000 }, async t => {
    const { worker } = await fixture(t, "timeout");
    await assert.rejects(worker.ready({ timeoutMs: 40 }), /timed out/i);
    await worker.stop(); assert.equal(worker.health().children.length, 0);
});
test("remote adapter supervises a separate worker and releases its lease after stop", { timeout: 15000 }, async t => {
    const root = fs.mkdtempSync("/tmp/opencode/est-worker-"); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const allocator = new PortAllocator([32300, 32399]), commands = [];
    const session = { sessionId: "session-host", sessionDir: root, clientsData: new Map([["p-a", { participantId: "p-a", socketId: "socket-a" }], ["p-b", { participantId: "p-b", socketId: "socket-b" }]]) };
    const adapter = new RemoteMediaAdapter({ config: settings(), allocator, clientRegistry: { emitToSocket: (id, event, command) => commands.push({ id, event, command }) }, onFailure: error => { throw error; } });
    t.after(() => adapter.dispose());
    await adapter.prepare({ session, attempt: { contextKey: "attempt-host" }, condition: {} });
    assert.notEqual(adapter.child.pid, process.pid); assert.equal(commands.filter(item => item.command.type === "prepareRemote").length, 2);
    await assert.rejects(adapter.signal("intruder", { connectionId: "uplink", generation: adapter.generation }), /participant|scope/);
    await adapter.stop({ session, attempt: { contextKey: "attempt-host" }, reason: "completed" });
    assert.ok(commands.some(item => item.command.type === "stopCore"));
    assert.equal(allocator.lease("other", 6)[0], 32300);
});
test("a core that never announces control readiness is killed on the startup deadline", { timeout: 10000 }, async t => {
    const root=fs.mkdtempSync('/tmp/opencode/est-slow-core-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const file=path.join(root,'slow.cjs');
    fs.writeFileSync(file,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync('+JSON.stringify(path.join(root,'pid'))+',String(process.pid));setInterval(()=>{},1000);\n',{mode:0o700});
    const worker=new MediaWorker({config:{...settings(),coreExecutable:file,startupTimeoutMs:200}});t.after(()=>worker.dispose());
    await assert.rejects(worker.prepare({...scope('slow'),condition:{},endpoints:[32500,32501,32502,32503,32504,32505]}),/readiness/);
    assert.equal(worker.health().children.length,0);
    const pid=Number(fs.readFileSync(path.join(root,'pid'),'utf8'));assert.throws(()=>process.kill(pid,0),/ESRCH/);
});
test("long impairment queues cannot trap shutdown or certify missing media as ready", { timeout: 15000 }, async t => {
    const {worker,owner}=await fixture(t,'long');
    await worker.stop();
    await worker.prepare({...owner,condition:{nativeDelay:120000,echoDelay:120000},endpoints:[32510,32511,32512,32513,32514,32515]});
    await peers(t,worker,owner);
    await assert.rejects(worker.ready({timeoutMs:100}),/timed out/i);
    await worker.stop();assert.equal(worker.health().children.length,0);
});
test("adapter retries occupied leases instead of repeatedly choosing the conflicting port", {timeout:15000},async t=>{
    const socket=dgram.createSocket('udp4');await new Promise(resolve=>socket.bind(32600,'127.0.0.1',resolve));t.after(()=>socket.close());
    const allocator=new PortAllocator([32600,32699]);
    const adapter=new RemoteMediaAdapter({config:settings(),allocator,clientRegistry:{emitToSocket(){}}});t.after(()=>adapter.dispose());
    const session={sessionId:'session-retry',clientsData:new Map([['a-retry',{}],['b-retry',{}]])};
    await adapter.prepare({session,attempt:{contextKey:'attempt-retry'},condition:{}});
    const health=await adapter.request('health');assert.equal(health.children.length,4);
    assert.ok(health.children.every(child=>!child.args.includes('32600')));
});
test("controller death closes its worker and all four core children", {timeout:15000},async t=>{
    const {fork}=require('node:child_process');
    const controller=fork(path.join(__dirname,'fixtures/worker-controller.cjs'),[],{stdio:['ignore','ignore','pipe','ipc']});
    t.after(()=>controller.kill('SIGKILL'));
    const reported=once(controller,'message');controller.send(settings());const [pids]=await reported;
    controller.kill('SIGKILL');await once(controller,'close');
    const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
    const deadline=Date.now()+10000;
    while(pids.cores.some(alive)&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
    assert.ok(pids.cores.every(pid=>!alive(pid)),'Orphan core PIDs: '+pids.cores.filter(alive));
});
test("authenticated signaling and media barriers reject impersonation and old generations", {timeout:20000},async t=>{
    const {createCoordinator}=require('../src/server.js');const {normalizeConfig}=require('../src/bootstraps/configManager.js');
    const {remoteConfig}=require('./fixtures/config.js');const {io:connect}=require('socket.io-client');const {randomUUID}=require('node:crypto');
    const raw=remoteConfig();raw.remote={...settings(),internalPortRange:[32700,32799]};
    const root=fs.mkdtempSync('/tmp/opencode/est-signal-');const app=createCoordinator({config:normalizeConfig(raw),root});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const sockets=[];
    t.after(async()=>{for(const socket of sockets)socket.disconnect();await app.close();fs.rmSync(root,{recursive:true,force:true});});
    const people=['signal-a','signal-b'].map(identity=>app.enrollments.admit({identity}));
    const session=app.registry.createPair(people.map(person=>app.enrollments.get(person.participantId)));
    for(const person of people){const socket=connect('http://127.0.0.1:'+app.server.address().port,{auth:{reconnectToken:person.reconnectToken},transports:['websocket'],reconnection:false});sockets.push(socket);await once(socket,'connect');}
    const prepared=once(sockets[0],'est-event:mediaCommand');session.effectStreamerCore.recordingContextStart('sct');
    const [command]=await prepared;assert.equal(command.type,'prepareRemote');
    const envelope=(index,type,payload)=>({version:1,requestId:randomUUID(),sessionId:session.sessionId,attemptId:command.attemptId,participantId:people[index].participantId,type,payload});
    const call=(index,event,message)=>sockets[index].timeout(7000).emitWithAck(event,message);
    const forged=await call(0,'est-event:signal',envelope(1,'signal',{...command,connectionId:'uplink',type:'ice',candidate:null,sdpMLineIndex:0}));
    assert.equal(forged.ok,false);assert.match(forged.error,/scope/);
    const stale=await call(0,'est-event:mediaResult',envelope(0,'mediaPrepared',{component:'remote',success:true,generation:'old'}));
    assert.equal(stale.ok,false);assert.match(stale.error,/generation/);
    const valid=await call(0,'est-event:signal',envelope(0,'signal',{generation:command.generation,connectionId:'uplink',type:'ice',candidate:null,sdpMLineIndex:0}));
    assert.equal(valid.ok,true);
    const peer=await startCore({executable:peerExecutable,args:['sender'],timeoutMs:3000});t.after(()=>peer.stop({timeoutMs:1500}));
    const offer=await peer.request('test.offer',{});
    const answered=await call(0,'est-event:signal',envelope(0,'signal',{...offer,connectionId:'uplink',generation:command.generation}));
    assert.equal(answered.ok,true);assert.equal(answered.signal.type,'answer');
});
test("disposing during core startup cannot leave a later-spawned child behind",{timeout:15000},async t=>{
    const worker=new MediaWorker({config:settings()});t.after(()=>worker.dispose());
    const preparing=worker.prepare({...scope('cancel'),condition:{},endpoints:[32800,32801,32802,32803,32804,32805]}).catch(()=>{});
    await worker.dispose();await preparing;
    assert.equal(worker.health().children.length,0);
});
