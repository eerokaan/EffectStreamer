const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {io:connect}=require('socket.io-client');
const {createCoordinator}=require('../../est-server/src/server.js');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {remoteConfig}=require('./fixtures/config.js');
const {checkoutPaths}=require('../../common/transient-paths.cjs');

test('a crashed pair releases admission capacity without replacing partners or stopping the second worker',{timeout:30000},async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-concurrency-'),raw=remoteConfig();
    raw.server.maxActivePairs=2;raw.sessions.operatingLimits.maxRetries=0;raw.pretestForm=[{name:'age',type:'input',label:'Age',inputType:'number',validation:{valueType:'integer',min:18}}];raw.conditions={baseline:[{}],random:[]};
    const config=normalizeConfig(raw);
    Object.assign(config.remote,{coreExecutable:process.env.EST_CORE_EXECUTABLE||checkoutPaths().path('est-core','build','linux','est-core'),internalPortRange:[36400,36499],icePortRange:[49000,49499],startupTimeoutMs:15000});
    const app=createCoordinator({config,root});await app.ready;app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port,sockets=[];
    t.after(async()=>{for(const socket of sockets)socket.disconnect();await app.close();await fs.rm(root,{recursive:true,force:true});});
    const people=[];
    for(let index=0;index<6;index++){
        const person=app.enrollments.admit({identity:'concurrent-'+index}),socket=connect(url,{auth:{reconnectToken:person.reconnectToken},transports:['websocket'],reconnection:false});sockets.push(socket);await once(socket,'connect');people.push({...person,socket});
        const action=async(type,payload)=>{const response=await socket.timeout(3000).emitWithAck('est-event:action',{version:1,requestId:randomUUID(),participantId:person.participantId,sessionId:null,attemptId:null,type,payload});assert.equal(response.ok,true,response.error);};
        await action('setupComplete',{inputUsable:true,playbackConfirmed:true});await action('nextView',{currentView:'viewWelcome'});await action('pretest',{formData:{age:25}});await action('nextView',{currentView:'viewPretest'});
    }
    const first=app.registry.getForParticipant(people[0].participantId),second=app.registry.getForParticipant(people[2].participantId);
    assert.equal(app.registry.sessions.size,2);assert.equal(app.registry.getForParticipant(people[4].participantId),undefined);
    for(const session of [first,second]){
        const commands=[...session.clientsData.keys()].map(id=>once(people.find(person=>person.participantId===id).socket,'est-event:mediaCommand'));
        for(const client of session.clientsData.values())await session.dispatch(client.participantId,{version:1,requestId:randomUUID(),participantId:client.participantId,sessionId:session.sessionId,attemptId:null,type:'nextView',payload:{currentView:'viewShortConversationTestExplanation'}});
        const prepared=await Promise.all(commands);assert.ok(prepared.every(([command])=>command.type==='prepareRemote'));
    }
    const healthy=(await second.mediaAdapter.request('health')).children.map(child=>child.pid);assert.equal(healthy.length,4);
    const changed=new Promise(resolve=>{const original=first.onChange;first.onChange=session=>{original(session);if(session.phase==='ended')resolve();};});
    first.mediaAdapter.child.kill('SIGKILL');await changed;
    assert.equal(first.outcome,'technicalFailure');assert.equal(second.phase,'experiment');assert.equal((await second.mediaAdapter.request('health')).children.length,4);
    for(const pid of healthy)assert.doesNotThrow(()=>process.kill(pid,0));
    const third=app.registry.getForParticipant(people[4].participantId);assert.ok(third);assert.equal(third,app.registry.getForParticipant(people[5].participantId));
    assert.deepEqual([...first.clientsData.keys()],people.slice(0,2).map(person=>person.participantId));assert.deepEqual([...second.clientsData.keys()],people.slice(2,4).map(person=>person.participantId));
    const cross=await people[2].socket.timeout(3000).emitWithAck('est-event:action',{version:1,requestId:randomUUID(),participantId:people[0].participantId,sessionId:first.sessionId,attemptId:first.recordingContextActive,type:'leave',payload:{}});assert.equal(cross.ok,false);
    assert.equal(second.outcome,null);assert.notEqual(first.sessionDir,second.sessionDir);assert.notEqual(second.sessionDir,third.sessionDir);
});
