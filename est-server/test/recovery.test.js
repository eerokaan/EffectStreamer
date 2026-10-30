const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SessionRegistry } = require("../src/services/SessionRegistry.js");
const { EnrollmentStore } = require("../src/services/EnrollmentStore.js");
const { RecoveryPolicy } = require("../src/services/RecoveryPolicy.js");
const { normalizeConfig } = require("../src/bootstraps/configManager.js");
const { remoteConfig } = require("./fixtures/config.js");

function fixture(t) {
    const root=fs.mkdtempSync('/tmp/opencode/est-recovery-');
    const raw=remoteConfig();raw.conditions={baseline:[{}],random:[]};
    const config=normalizeConfig(raw),enrollments=new EnrollmentStore(root),events=[];
    const io={to:id=>({emit:(event,data)=>events.push({id,event,data})}),sockets:{sockets:new Map()}};
    const registry=new SessionRegistry({config,io,root,enrollments});
    let time=1000;const recovery=new RecoveryPolicy({config,registry,now:()=>time});registry.recovery=recovery;
    t.after(async()=>{recovery.close();await Promise.all([...registry.sessions.values()].map(session=>session.dispose()));await Promise.all(registry.store.pending.values());fs.rmSync(root,{recursive:true,force:true});});
    function pair(prefix) {
        const people=['a','b'].map(role=>enrollments.get(enrollments.admit({identity:prefix+'-'+role}).participantId));
        const session=registry.createPair(people);
        for(const client of session.clientsData.values()){client.socketId=client.participantId;client.setupComplete=true;client.pretestComplete=true;session.clientsSocketRegistry.set(client.socketId,client.participantId);}
        // Replace only external process transport; assertions exercise the actual
        // coordinator, attempts, persistence, partner and readiness state.
        session.mediaAdapter={prepare:async()=>{},start:async()=>{},stop:async()=>{},dispose:async()=>{}};
        session.conditionOrder=[2,0,1];session.conditionListeningSpeakingTestIndex=1;
        session.effectStreamerCore.recordingContextStart('lst');
        const context=session.recordingContexts.get(session.recordingContextActive);context.status='running';
        session.attempts[0].status='running';
        for(const client of session.clientsData.values()){client.currentView='viewListeningSpeakingTestMain';client.viewData=session.viewFlow.getViewData(session.viewFlow.getViewByName(client.currentView),client);}
        return {session,people,context};
    }
    return {config,registry,enrollments,recovery,pair,events,root,setTime:value=>{time=value;}};
}
test('active disconnect preserves the pair, original settings/roles and incomplete attempt while the other pair proceeds',async t=>{
    const f=fixture(t),a=f.pair('first'),b=f.pair('other');
    a.session.clientsData.get(a.people[0].participantId).socketId=null;
    await f.recovery.disconnected(a.people[0].participantId,'socket');
    assert.equal(a.session.phase,'interrupted');assert.equal(a.session.attempts[0].status,'interrupted');
    assert.equal(a.session.recovery.deadline,61000);assert.equal(b.session.phase,'experiment');assert.equal(b.context.status,'running');
    assert.ok(f.events.some(event=>event.data.type==='requestResume'),'both participants must be asked for retained/missing inventory even without another socket reconnect');
    const old=a.context.contextKey;
    for(const person of a.people){const client=a.session.clientsData.get(person.participantId);client.socketId=person.participantId;client.setupComplete=true;await f.recovery.resumed(person.participantId,{manifests:[],mediaPresent:false});}
    await f.recovery.reconnected(a.people[0].participantId,{ready:true});await f.recovery.reconnected(a.people[1].participantId,{ready:true});
    assert.notEqual(a.session.recordingContextActive,old);assert.equal(a.session.phase,'experiment');
    assert.deepEqual([...a.session.clientsData.keys()],a.people.map(person=>person.participantId));assert.deepEqual([...a.session.clientsData.values()].map(client=>client.role),['a','b']);
    assert.deepEqual(a.session.conditionOrder,[2,0,1]);assert.equal(a.session.conditionListeningSpeakingTestIndex,1);assert.equal(a.session.attempts[1].roundSuffix,'-r2');
    assert.equal(a.session.attempts[0].status,'interrupted');assert.equal(a.session.attempts[0].missingRecordings.length,2);
    await assert.rejects(a.session.dispatch(a.people[0].participantId,{version:1,requestId:'late-old',participantId:a.people[0].participantId,sessionId:a.session.sessionId,attemptId:old,type:'mediaStarted',payload:{success:true}}),/attempt/);
});
test('grace expiry or a second interruption exhausts only that pair and never replaces a partner',async t=>{
    const f=fixture(t),a=f.pair('expire');await f.recovery.disconnected(a.people[0].participantId,'socket');
    f.setTime(61001);await f.recovery.expire(a.session.sessionId);assert.equal(a.session.outcome,'technicalFailure');assert.equal(a.session.phase,'ended');
    const b=f.pair('retry');await f.recovery.disconnected(b.people[0].participantId,'socket');
    for(const person of b.people){const client=b.session.clientsData.get(person.participantId);client.socketId=person.participantId;client.setupComplete=true;await f.recovery.resumed(person.participantId,{manifests:[],mediaPresent:false});await f.recovery.reconnected(person.participantId,{ready:true});}
    await f.recovery.disconnected(b.people[0].participantId,'media');assert.equal(b.session.outcome,'technicalFailure');assert.equal(b.session.attempts.length,2);
});
test('upload disconnect keeps a completed conversation and resumes receipts instead of retrying it',async t=>{
    const f=fixture(t),a=f.pair('upload');a.context.status='uploading';a.session.attempts[0].status='uploading';a.session.attempts[0].uploadDeadline=9000;
    await f.recovery.disconnected(a.people[0].participantId,'socket');
    assert.equal(a.session.recovery.kind,'upload');assert.equal(a.session.recovery.deadline,9000);assert.notEqual(a.session.attempts[0].status,'interrupted');
    assert.equal(a.session.attempts.length,1);assert.equal(a.context.interrupted,undefined);
    f.setTime(9001);await f.recovery.expire(a.session.sessionId);assert.equal(a.session.outcome,'technicalFailure');
});
test('restart ends active conversations but restores stopped/upload-only contexts and token ownership',async t=>{
    const f=fixture(t),active=f.pair('live'),upload=f.pair('stored');
    upload.context.status='uploading';upload.session.attempts[0].status='uploading';upload.session.attempts[0].uploadDeadline=Date.now()+10000;
    upload.context.sockets.stopped=new Set(upload.people.map(person=>person.participantId));upload.context.sockets.viewChangePending=new Set(upload.people.map(person=>person.participantId));
    await active.session.persist();await upload.session.persist();const manifests=await f.registry.store.loadAll();
    const restored=new SessionRegistry({config:f.config,io:{to:()=>({emit(){}})},root:f.root,enrollments:new EnrollmentStore(f.root)});
    const policy=new RecoveryPolicy({config:f.config,registry:restored});restored.recovery=policy;t.after(()=>policy.close());
    await policy.recoverAfterRestart(manifests);
    const a=restored.getForParticipant(active.people[0].participantId),b=restored.getForParticipant(upload.people[0].participantId);
    assert.equal(a.outcome,'technicalFailure');assert.equal(a.attempts[0].status,'interrupted');
    assert.equal(b.recovery.kind,'upload');assert.equal(b.recordingContextActive,upload.context.contextKey);assert.equal(b.attempts[0].status,'uploading');
    assert.deepEqual([...b.recordingContexts.get(b.recordingContextActive).sockets.viewChangePending],upload.people.map(person=>person.participantId));
    await Promise.all([...restored.sessions.values()].map(session=>session.dispose()));await Promise.all(restored.store.pending.values());
});
test('a page reload losing upload-only RAM is explicit missing data, not a successful conversation retry',async t=>{
    const f=fixture(t),a=f.pair('reload');a.context.status='uploading';a.session.attempts[0].status='uploading';
    await f.recovery.disconnected(a.people[0].participantId,'socket');
    await f.recovery.resumed(a.people[0].participantId,{manifests:[],mediaPresent:false});
    assert.equal(a.session.outcome,'technicalFailure');assert.equal(a.session.attempts.length,1);
    assert.deepEqual(a.session.attempts[0].missingRecordings,[{participantId:a.people[0].participantId,tracks:['microphone','headphones']}]);
});
test('a failed upload expires even if both signaling sockets stay connected',async t=>{
    const f=fixture(t),a=f.pair('deadline');a.context.status='uploading';a.session.attempts[0].status='uploading';a.session.attempts[0].uploadDeadline=1200;
    f.setTime(1201);await f.recovery.expire(a.session.sessionId);assert.equal(a.session.outcome,'technicalFailure');
});
test('late receipt reconciliation preserves an expired pair terminal phase and outcome',async t=>{
    const f=fixture(t),a=f.pair('late');a.context.status='uploading';a.session.attempts[0].status='uploading';a.context.sockets.stopped=new Set(a.people.map(person=>person.participantId));
    a.context.files.uploaded=new Set([a.people[0].participantId+':microphone',a.people[0].participantId+':headphones',a.people[1].participantId+':microphone']);
    a.session.recovery={kind:'upload',attemptId:a.context.contextKey,deadline:0};await f.recovery.end(a.session,'technicalFailure');
    await a.session.receivedRecording({attemptId:a.context.contextKey,participantId:a.people[1].participantId,track:'headphones',status:'complete'},{recordingId:'late',sha256:'a'.repeat(64),stored:true});
    assert.equal(a.session.phase,'ended');assert.equal(a.session.outcome,'technicalFailure');
});
test('a departure after completion cannot replace an already-issued final outcome',async t=>{
    const f=fixture(t),a=f.pair('terminal');
    await f.recovery.end(a.session,'technicalFailure');
    await f.recovery.end(a.session,'partnerLeft');
    assert.equal(a.session.outcome,'technicalFailure');
    assert.ok(a.people.every(person=>f.enrollments.get(person.participantId).outcome==='technicalFailure'));
});
test('invalidating setup between attempts blocks progression until the routes are tested again',async t=>{
    const f=fixture(t),a=f.pair('setup-lost');await Promise.allSettled(a.session.mediaOperations);
    a.session.recordingContextActive=null;const person=a.people[0],client=a.session.clientsData.get(person.participantId);
    client.currentView='viewListeningSpeakingTestExplanation';a.session.gates.viewChange.add(a.people[1].participantId);
    const dispatch=(type,payload)=>a.session.dispatch(person.participantId,{version:1,requestId:require('node:crypto').randomUUID(),participantId:person.participantId,sessionId:a.session.sessionId,attemptId:null,type,payload});
    await dispatch('setupInvalidated',{});
    assert.equal(client.setupComplete,false);assert.equal(f.enrollments.get(person.participantId).setupComplete,false);assert.equal(a.session.gates.viewChange.size,0);
    await assert.rejects(dispatch('nextView',{currentView:client.currentView}),/setup/i);
    await dispatch('setupComplete',{inputUsable:true,playbackConfirmed:true});assert.equal(client.setupComplete,true);
});
test('a bounded worker failure can retry after its children stop even when graceful drain reports an error',async t=>{
    const f=fixture(t),a=f.pair('worker-error');a.session.mediaAdapter.stop=async()=>{throw new Error('Core failed after children were reaped');};
    await f.recovery.disconnected(a.people[0].participantId,'worker');await Promise.allSettled(a.session.mediaOperations);
    assert.equal(a.context.workerStopped,true);
    for(const person of a.people){a.session.clientsData.get(person.participantId).setupComplete=true;await f.recovery.resumed(person.participantId,{manifests:[],mediaPresent:false});await f.recovery.reconnected(person.participantId,{ready:true});}
    assert.equal(a.session.phase,'experiment');assert.equal(a.session.attempts.length,2);
});
test('a restarted coordinator resumes chunk offsets and durable receipts without repeating an upload-only conversation',async t=>{
    const {createCoordinator}=require('../src/server.js');const {createHash,randomUUID}=require('node:crypto');
    const root=fs.mkdtempSync('/tmp/opencode/est-restart-upload-');const raw=remoteConfig(),config=normalizeConfig(raw);let app=createCoordinator({config,root});await app.ready;
    t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
    const people=['persist-a','persist-b'].map(identity=>app.enrollments.admit({identity}));
    let session=app.registry.createPair(people.map(person=>app.enrollments.get(person.participantId)));
    session.mediaAdapter={prepare:async()=>{},stop:async()=>{},dispose:async()=>{}};session.effectStreamerCore.recordingContextStart('sct');
    const context=session.recordingContexts.get(session.recordingContextActive);context.status='uploading';context.workerStopped=true;
    context.sockets.stopped=new Set(people.map(person=>person.participantId));context.sockets.viewChangePending=new Set(people.map(person=>person.participantId));
    session.attempts[0].status='uploading';session.attempts[0].uploadDeadline=Date.now()+30000;
    for(const client of session.clientsData.values()){client.currentView='viewShortConversationTestMain';client.setupComplete=true;client.pretestComplete=true;}
    const bytes=Buffer.alloc(48);bytes.write('RIFF');bytes.writeUInt32LE(40,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(4,40);bytes.writeInt16LE(8192,44);bytes.writeInt16LE(8192,46);
    const manifests=[];
    for(const person of people)for(const track of ['microphone','headphones']) {
        const manifest={recordingId:randomUUID(),sessionId:session.sessionId,participantId:person.participantId,attemptId:context.contextKey,track,filename:track+'.wav',source:'browser-memory',contentType:'audio/wav',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'complete'};manifests.push(manifest);
        await app.transfers.register(person,[manifest]);await app.transfers.append(person,manifest.recordingId,0,bytes.subarray(0,32));
    }
    const sessionId=session.sessionId;await session.persist();await app.close();
    app=createCoordinator({config,root});await app.ready;session=app.registry.sessions.get(sessionId);assert.equal(session.recovery.kind,'upload');
    assert.equal(app.enrollments.authenticate(people[0].reconnectToken).participantId,people[0].participantId);
    for(const manifest of manifests) {
        const person=app.enrollments.get(manifest.participantId),started=await app.transfers.begin(person,manifest);assert.equal(started.nextByteOffset,32);
        await app.transfers.append(person,manifest.recordingId,32,bytes.subarray(32));const receipt=await app.transfers.commit(person,manifest.recordingId);
        assert.deepEqual(await app.transfers.commit(person,manifest.recordingId),receipt);
    }
    assert.equal(session.attempts.length,1);assert.equal(session.attempts[0].status,'completed');assert.equal(session.attempts[0].receipts.length,4);assert.equal(session.recovery,null);assert.equal(session.phase,'experiment');
    assert.ok([...session.clientsData.values()].every(client=>client.currentView==='viewShortConversationTestEvaluation'));
});
