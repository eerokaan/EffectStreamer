const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {io:connect}=require('socket.io-client');
const {createCoordinator}=require('../../est-server/src/server.js');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {localConfig,remoteConfig,pretestAnswers}=require('./fixtures/config.js');
const {SessionStore}=require('../../est-server/src/services/SessionStore.js');
const {EnrollmentStore}=require('../../est-server/src/services/EnrollmentStore.js');
const {checkoutPaths}=require('../../common/transient-paths.cjs');

async function fixture(t,raw=localConfig()) {
    const root=checkoutPaths().temporaryDirectory('est-server','est-session-');
    const app=createCoordinator({config:normalizeConfig(raw),root});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    const url='http://127.0.0.1:'+app.server.address().port;
    const sockets=[];
    t.after(async()=>{for(const socket of sockets) socket.disconnect();await app.close();fs.rmSync(root,{recursive:true,force:true});});
    async function enroll(identity) {
        const response=await fetch(url+'/api/enrollment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity,ipAddress:'127.0.0.1',operatingSystem:'linux'})});
        assert.equal(response.status,201,await response.clone().text());return response.json();
    }
    async function join(enrollment) {
        const socket=connect(url,{auth:{reconnectToken:enrollment.reconnectToken},transports:['websocket'],reconnection:false});sockets.push(socket);
        const connected=once(socket,'connect');const error=once(socket,'connect_error').then(([e])=>Promise.reject(e));
        await Promise.race([connected,error]);return socket;
    }
    return {...app,root,url,enroll,join};
}
async function action(session,participant,type='nextView',payload={}) {
    const snapshot=session.snapshot(participant.participantId);
    return session.dispatch(participant.participantId,{version:1,requestId:require('node:crypto').randomUUID(),sessionId:session.sessionId,participantId:participant.participantId,attemptId:snapshot.attemptId,type,payload:{currentView:snapshot.currentView,...payload}});
}
test('two pairs own independent views, role assets, conditions, and result directories',async(t)=>{
    const raw=remoteConfig();raw.deployment.allowDevelopmentAdmission=true;
    const app=await fixture(t,raw);
    const people=await Promise.all(['prolific-person-1','person-2','person-3','person-4'].map(app.enroll));
    const first=app.registry.createPair(people.slice(0,2).map(p=>app.enrollments.get(p.participantId)));
    const second=app.registry.createPair(people.slice(2).map(p=>app.enrollments.get(p.participantId)));
    await Promise.all(people.map(app.join));
    await assert.rejects(action(first,people[0]),/setup required/i);
    await action(first,people[0],'setupComplete',{inputUsable:true,playbackConfirmed:true});
    await action(first,people[1],'setupComplete',{inputUsable:true,playbackConfirmed:true});
    await action(first,people[0]);await action(first,people[1]);
    assert.equal(first.snapshot(people[0].participantId).currentView,'viewPretest');
    assert.equal(second.snapshot(people[2].participantId).currentView,'viewWelcome');
    first.conditionIndex=2;first.conditionOrder=[3,1,0];
    assert.equal(second.conditionIndex,0);assert.deepEqual(second.conditionOrder,[]);
    assert.match(first.viewFlow.getClientConditionAsset(first.clientsData.get(people[0].participantId)),/^client-a\/03\.png$/);
    assert.match(first.viewFlow.getClientConditionAsset(first.clientsData.get(people[1].participantId)),/^client-b\/03\.png$/);
    assert.notEqual(first.sessionDir,second.sessionDir);
    assert.equal(app.registry.getForParticipant(people[0].participantId),first);
    await first.persist();
    const saved=(await app.registry.store.loadAll()).find(value=>value.sessionId===first.sessionId);
    assert.deepEqual(saved.conditionOrder,[3,1,0]);assert.equal(saved.conditionIndex,2);
});
test('replacement sockets and duplicate actions count only once toward a view barrier',async(t)=>{
    const app=await fixture(t);
    const a=await app.enroll('client-a'),b=await app.enroll('client-b');
    await app.join(a);await app.join(b);
    const session=app.registry.getForParticipant(a.participantId);
    await action(session,a);await action(session,b);
    await action(session,a,'pretest',{formData:pretestAnswers()});await action(session,b,'pretest',{formData:pretestAnswers()});
    await action(session,a);
    assert.equal(session.gates.viewChange.size,1);
    await app.join(a);await action(session,a);
    assert.equal(session.gates.viewChange.size,1);
    assert.equal(session.snapshot(a.participantId).currentView,'viewPretest');
    await action(session,b);
    assert.equal(session.snapshot(a.participantId).currentView,'viewShortConversationTestExplanation');
});
test('local clients can start a fresh run after an ended pair without reopening old results',async t=>{
    const app=await fixture(t),a=await app.enroll('client-a'),b=await app.enroll('client-b');
    await app.join(a);await app.join(b);const original=app.registry.getForParticipant(a.participantId);
    const renew=async(identity,credentials)=>{
        const response=await fetch(app.url+'/api/enrollment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity,ipAddress:'127.0.0.1',operatingSystem:'linux',reconnectToken:credentials.reconnectToken})});
        assert.equal(response.status,201,await response.clone().text());return response.json();
    };
    assert.deepEqual(await renew('client-a',a),a,'relaunching during an unfinished run must resume, not replace it');
    await app.recovery.end(original,'technicalFailure');const oldManifest=await fs.promises.readFile(path.join(original.sessionDir,'session.json'),'utf8');
    const nextA=await renew('client-a',a),nextB=await renew('client-b',b);assert.notEqual(nextA.participantId,a.participantId);
    await app.join(nextA);await app.join(nextB);const next=app.registry.getForParticipant(nextA.participantId);
    assert.notEqual(next.sessionId,original.sessionId);assert.equal(next.phase,'experiment');assert.deepEqual([...next.clientsData.values()].map(person=>person.role),['a','b']);
    assert.equal(app.registry.getForParticipant(a.participantId),original);assert.equal(original.outcome,'technicalFailure');
    assert.equal(app.enrollments.authenticate(a.reconnectToken).participantId,a.participantId);
    assert.equal(await fs.promises.readFile(path.join(original.sessionDir,'session.json'),'utf8'),oldManifest);
    await assert.rejects(app.enroll('client-a'),/201/,'a duplicate live label must still be rejected');
});
test('local run renewal does not allow a terminal remote identity to enroll again',async t=>{
    const raw=remoteConfig();raw.deployment.allowDevelopmentAdmission=true;const app=await fixture(t,raw);
    const a=await app.enroll('client-a'),b=await app.enroll('client-b');const session=app.registry.createPair([a,b].map(person=>app.enrollments.get(person.participantId)));
    await app.recovery.end(session,'technicalFailure');
    const response=await fetch(app.url+'/api/enrollment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:'client-a',reconnectToken:a.reconnectToken})});
    assert.equal(response.status,409);assert.equal(app.registry.getForParticipant(a.participantId).outcome,'technicalFailure');
});
test('another session, participant, stale view or stale attempt cannot change experiment state',async(t)=>{
    const app=await fixture(t);
    const a=await app.enroll('client-a'),b=await app.enroll('client-b');await app.join(a);await app.join(b);
    const session=app.registry.getForParticipant(a.participantId);
    const request={version:1,requestId:'bad',participantId:a.participantId,sessionId:session.sessionId,attemptId:null,type:'nextView',payload:{currentView:'viewWelcome'}};
    for(const change of [{participantId:b.participantId},{sessionId:'other'},{attemptId:'old-attempt'},{payload:{currentView:'viewEnding'}}]) {
        await assert.rejects(session.dispatch(a.participantId,{...request,...change}),/scope|view|attempt|participant/i);
    }
    assert.equal(session.snapshot(a.participantId).currentView,'viewWelcome');
});
test('public configuration precedes enrollment and production remote admission refuses development identities',async(t)=>{
    const app=await fixture(t,remoteConfig());
    const response=await fetch(app.url+'/api/config');assert.equal(response.status,200);
    assert.equal((await response.json()).setupRequired,true);
    const refused=await fetch(app.url+'/api/enrollment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:'bypass'})});
    assert.equal(refused.status,403);
});
test('enrollment credentials persist without plaintext tokens or duplicate enrollment',async(t)=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-credentials-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const first=new EnrollmentStore(root);const enrolled=first.admit({identity:'external/identity'});
    assert.throws(()=>first.admit({identity:'external/identity'}),/already enrolled/);
    const restored=new EnrollmentStore(root);
    assert.equal(restored.authenticate(enrolled.reconnectToken).participantId,enrolled.participantId);
    assert.equal(restored.authenticate('wrong'),null);
    assert.ok(!fs.readFileSync(path.join(root,'enrollments.json'),'utf8').includes(enrolled.reconnectToken));
});
test('session-store writes are serialized and cannot escape their owned directory',async(t)=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-store-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=new SessionStore(root);
    await Promise.all([store.save({sessionId:'session-1',revision:1}),store.save({sessionId:'session-1',revision:2})]);
    assert.equal((await store.loadAll())[0].revision,2);
    await assert.rejects(store.save({sessionId:'../outside',revision:3}));
});
test('authenticated socket actions cannot impersonate another participant',async(t)=>{
    const app=await fixture(t);
    const a=await app.enroll('client-a'),b=await app.enroll('client-b');
    const socket=await app.join(a);await app.join(b);
    const session=app.registry.getForParticipant(a.participantId);
    const reply=await socket.timeout(2000).emitWithAck('est-event:action',{version:1,requestId:'forged',sessionId:session.sessionId,participantId:b.participantId,attemptId:null,type:'nextView',payload:{currentView:'viewWelcome'}});
    assert.equal(reply.ok,false);assert.match(reply.error,/scope/);
    const valid=await socket.timeout(2000).emitWithAck('est-event:action',{version:1,requestId:'valid',sessionId:session.sessionId,participantId:a.participantId,attemptId:null,type:'nextView',payload:{currentView:'viewWelcome'}});
    assert.equal(valid.ok,true);assert.equal(valid.snapshot.currentView,'viewPretest');
});
test('replacing a paired browser socket does not interrupt the active participant slot',async t=>{
    const raw=remoteConfig();raw.deployment.allowDevelopmentAdmission=true;const app=await fixture(t,raw);
    const a=await app.enroll('tab-a'),b=await app.enroll('tab-b');
    const session=app.registry.createPair([app.enrollments.get(a.participantId),app.enrollments.get(b.participantId)]);
    await app.join(a);await app.join(b);
    const context={contextKey:'active-replacement',status:'uploading'};session.recordingContexts.set(context.contextKey,context);session.recordingContextActive=context.contextKey;
    session.attempts.push({attemptId:context.contextKey,status:'uploading'});
    await app.join(a);assert.equal(context.interrupted,undefined);assert.equal(session.phase,'experiment');
    session.recordingContextActive=null;
});
