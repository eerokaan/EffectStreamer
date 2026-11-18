const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {SessionRegistry}=require('../../est-server/src/services/SessionRegistry.js');
const {EnrollmentStore}=require('../../est-server/src/services/EnrollmentStore.js');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {localConfig,pretestAnswers}=require('./fixtures/config.js');

function fixture(t) {
    const root=checkoutPaths().temporaryDirectory('est-server','protocol-state-'),events=[];
    const raw=localConfig();raw.conditions={baseline:[{}],random:[]};
    const enrollments=new EnrollmentStore(root,{sessionLanguage:raw.sessions.general.language}),people=['a','b'].map(identity=>enrollments.get(enrollments.admit({identity,ipAddress:'127.0.0.1'}).participantId));
    const io={to:id=>({emit:(event,data)=>events.push({id,event,data})}),sockets:{sockets:new Map()}};
    const registry=new SessionRegistry({root,config:normalizeConfig(raw),enrollments,io}),session=registry.createPair(people);
    for(const client of session.clientsData.values()){client.socketId=client.participantId;session.clientsSocketRegistry.set(client.socketId,client.participantId);}
    t.after(async()=>{await session.dispose();await Promise.all(registry.store.pending.values());fs.rmSync(root,{recursive:true,force:true});});
    const action=(person,type='nextView',payload={})=>session.dispatch(person.participantId,{version:1,requestId:randomUUID(),participantId:person.participantId,sessionId:session.sessionId,attemptId:session.recordingContextActive,type,payload:{currentView:session.snapshot(person.participantId).currentView,...payload}});
    const both=async(type,payload)=>{for(const person of people)await action(person,type,payload);};
    const start=async()=>{
        await both();await both('pretest',{formData:pretestAnswers()});await both();await both();
        await Promise.all([...session.mediaOperations]);
        return session.recordingContexts.get(session.recordingContextActive);
    };
    return {session,people,events,action,both,start};
}
function assertCurrentWire(events) {
    assert.ok(events.some(({event})=>event==='est-event:snapshot'));
    assert.deepEqual(events.filter(({event})=>!['est-event:snapshot','est-event:mediaCommand'].includes(event)),[]);
}
test('direct and gated navigation publish authoritative snapshots without view notifications',async t=>{
    const f=fixture(t);await f.both();
    assert.equal(f.session.snapshot(f.people[0].participantId).currentView,'viewPretest');
    await f.both('pretest',{formData:pretestAnswers()});await f.both();
    assert.equal(f.session.snapshot(f.people[1].participantId).currentView,'viewShortConversationTestExplanation');
    assertCurrentWire(f.events);
});
test('media preparation/start/stop barriers use current commands and snapshot recording status only',async t=>{
    const f=fixture(t),context=await f.start();
    for(const component of ['sender','receiver'])await f.both('mediaPrepared',{component,success:true});
    await f.both('mediaStarted',{success:true});
    assert.equal(f.session.snapshot(f.people[0].participantId).viewData.recordingStatus,'running');
    await f.action(f.people[0]);await f.both('mediaStopped',{success:true});
    assert.equal(context.status,'uploading');
    assertCurrentWire(f.events);
});
test('leaving an active view preserves the peer dialog in snapshots without a view event',async t=>{
    const f=fixture(t);await f.start();await f.action(f.people[0]);
    const peer=f.session.snapshot(f.people[1].participantId);
    assert.equal(peer.currentView,'viewShortConversationTestMain');assert.equal(peer.viewData.showDialog,true);
    assertCurrentWire(f.events);
});
test('pending recording completion updates an offline participant and persists its next view',async t=>{
    const f=fixture(t),context=await f.start();
    await f.both();await f.both('mediaStopped',{success:true});
    f.session.clientsData.get(f.people[0].participantId).socketId=null;
    for(const person of f.people)for(const track of ['microphone','headphones'])await f.session.receivedRecording({attemptId:context.contextKey,participantId:person.participantId,track,status:'complete'},{stored:true});
    assert.equal(f.session.snapshot(f.people[0].participantId).currentView,'viewShortConversationTestEvaluation');
    assert.equal(f.session.snapshot(f.people[1].participantId).currentView,'viewShortConversationTestEvaluation');
    const saved=(await f.session.store.loadAll()).find(item=>item.sessionId===f.session.sessionId);
    assert.ok(saved.participants.every(person=>person.currentView==='viewShortConversationTestEvaluation'));
    assertCurrentWire(f.events);
});
