const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {RecordingTransfers}=require('../../est-server/src/services/RecordingTransfers.js');
const {EffectStreamerCore}=require('../../est-server/src/services/EffectStreamerCore.js');
const {checkoutPaths}=require('../../common/transient-paths.cjs');

function wave(frames=8) {
    const bytes=Buffer.alloc(44+2*frames);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
    bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);
    bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
    for(let i=44;i<bytes.length;i+=2) bytes.writeInt16LE(8192,i);
    return bytes;
}
function fixture(t) {
    const root=checkoutPaths().temporaryDirectory('est-server','est-uploads-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const participant={participantId:'person-a'},bytes=wave();
    const session={sessionId:'session-1',sessionDir:path.join(root,'session-1'),clientsData:new Map([['person-a',participant]]),attempts:[{attemptId:'attempt-1',status:'stopping'}],persist:async()=>{}};
    fs.mkdirSync(session.sessionDir);
    const manifest={recordingId:'recording-1',sessionId:'session-1',participantId:'person-a',attemptId:'attempt-1',track:'microphone',filename:'microphone.wav',source:'browser-memory',contentType:'audio/wav',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'complete'};
    const options={root,getSession:()=>session,config:{chunkBytes:32,maxBytesPerParticipant:1000000,uploadTimeoutMs:10000}};
    return {root,participant,session,manifest,bytes,options,transfers:new RecordingTransfers(options)};
}
test('the duration-derived budget stores both full-duration WAV tracks with shutdown headroom',async t=>{
    const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js'),{localConfig}=require('./fixtures/config.js');
    const raw=localConfig();raw.sessions.operatingLimits.maxConditionSeconds=1;
    const config=normalizeConfig(raw).recordings,f=fixture(t),transfers=new RecordingTransfers({...f.options,config});
    // One configured second plus the full bounded 139-second stop/dispose tail.
    const bytes=wave(140*48000),sha256=createHash('sha256').update(bytes).digest('hex');
    const manifests=['microphone','headphones'].map(track=>({...f.manifest,recordingId:'full-'+track,track,filename:track+'.wav',byteLength:bytes.length,sha256}));
    await transfers.register(f.participant,manifests);
    for(const manifest of manifests) {
        await transfers.begin(f.participant,manifest);
        for(let offset=0;offset<bytes.length;offset+=config.chunkBytes)await transfers.append(f.participant,manifest.recordingId,offset,bytes.subarray(offset,offset+config.chunkBytes));
        assert.equal((await transfers.commit(f.participant,manifest.recordingId)).stored,true);
    }
});
test('announced recordings cannot exceed the duration-derived participant budget',async t=>{
    const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js'),{localConfig}=require('./fixtures/config.js');
    const raw=localConfig();raw.sessions.operatingLimits.maxConditionSeconds=1;
    const f=fixture(t),transfers=new RecordingTransfers({...f.options,config:normalizeConfig(raw).recordings});
    await assert.rejects(transfers.register(f.participant,[{...f.manifest,byteLength:26888193}]),/byte limit/);
    assert.equal(f.session.attempts[0].recordings,undefined);
});
test('interrupted chunks resume, duplicate chunks are checked, and a lost receipt returns the same durable result',async(t)=>{
    const f=fixture(t);await f.transfers.register(f.participant,[f.manifest]);
    const upload=await f.transfers.begin(f.participant,f.manifest);assert.equal(upload.nextByteOffset,0);
    await f.transfers.append(f.participant,upload.uploadId,0,f.bytes.subarray(0,32));
    assert.deepEqual(fs.readFileSync(path.join(f.session.sessionDir,'attempts','attempt-1','person-a','microphone.wav')),f.bytes.subarray(0,32));
    assert.equal(fs.existsSync(path.join(f.root,'.uploads','recording-1.part')),false);
    await f.transfers.append(f.participant,upload.uploadId,0,f.bytes.subarray(0,32));
    await assert.rejects(f.transfers.append(f.participant,upload.uploadId,0,Buffer.alloc(32)),/conflicting/i);
    const restarted=new RecordingTransfers(f.options);
    const resumed=await restarted.begin(f.participant,f.manifest);assert.equal(resumed.nextByteOffset,32);
    await restarted.append(f.participant,resumed.uploadId,32,f.bytes.subarray(32));
    const receipt=await restarted.commit(f.participant,resumed.uploadId);
    assert.deepEqual(receipt,{recordingId:'recording-1',sha256:f.manifest.sha256,stored:true});
    const again=new RecordingTransfers(f.options);
    assert.deepEqual(await again.commit(f.participant,resumed.uploadId),receipt);
    assert.deepEqual(fs.readFileSync(path.join(f.session.sessionDir,'attempts','attempt-1','person-a','microphone.wav')),f.bytes);
});
test('unknown owners, unannounced IDs, expired attempts and unsafe paths cannot upload',async(t)=>{
    const f=fixture(t);
    await assert.rejects(f.transfers.begin(f.participant,f.manifest),/announced|registered/i);
    await f.transfers.register(f.participant,[f.manifest]);
    await assert.rejects(f.transfers.begin({participantId:'person-b'},f.manifest),/owner|participant/i);
    await assert.rejects(f.transfers.register(f.participant,[{...f.manifest,recordingId:'other',attemptId:'unknown'}]),/attempt/i);
    await assert.rejects(f.transfers.register(f.participant,[{...f.manifest,filename:'../out.wav'}]));
    const expired=new RecordingTransfers({...f.options,now:()=>Date.now()+20000});
    await assert.rejects(expired.begin(f.participant,f.manifest),/expired/);
});
test('a retained interrupted recording from an earlier known attempt can finish without completing the new attempt',async(t)=>{
    const f=fixture(t);f.manifest.status='interrupted';f.session.attempts[0].status='interrupted';
    f.session.attempts.push({attemptId:'attempt-2',status:'running'});
    await f.transfers.register(f.participant,[f.manifest]);const upload=await f.transfers.begin(f.participant,f.manifest);
    await f.transfers.append(f.participant,upload.uploadId,0,f.bytes.subarray(0,32));
    await f.transfers.append(f.participant,upload.uploadId,32,f.bytes.subarray(32));
    await f.transfers.commit(f.participant,upload.uploadId);
    assert.equal(f.session.attempts[1].status,'running');assert.equal(f.session.attempts[0].status,'interrupted');
});
test('corrupt WAVs, digest mismatch and incomplete transfers never produce stored receipts',async(t)=>{
    for(const kind of ['wav','digest','length']) {
        const f=fixture(t);const bytes=Buffer.from(f.bytes);
        if(kind==='wav') {bytes.write('OggS');f.manifest.sha256=createHash('sha256').update(bytes).digest('hex');}
        if(kind==='digest') f.manifest.sha256='f'.repeat(64);
        await f.transfers.register(f.participant,[f.manifest]);const upload=await f.transfers.begin(f.participant,f.manifest);
        await f.transfers.append(f.participant,upload.uploadId,0,bytes.subarray(0,32));
        if(kind!=='length') await f.transfers.append(f.participant,upload.uploadId,32,bytes.subarray(32));
        await assert.rejects(f.transfers.commit(f.participant,upload.uploadId),/WAV|digest|incomplete/i);
        const record=JSON.parse(fs.readFileSync(path.join(f.root,'.uploads','recording-1.json')));
        assert.equal(record.receipt,undefined);
    }
});
test('direct destination failure cannot acknowledge data as stored and can be retried',async(t)=>{
    const f=fixture(t);await f.transfers.register(f.participant,[f.manifest]);const u=await f.transfers.begin(f.participant,f.manifest);
    fs.writeFileSync(path.join(f.session.sessionDir,'attempts'),'not a directory');
    await assert.rejects(f.transfers.append(f.participant,u.uploadId,0,f.bytes.subarray(0,32)));
    fs.unlinkSync(path.join(f.session.sessionDir,'attempts'));
    await f.transfers.append(f.participant,u.uploadId,0,f.bytes.subarray(0,32));await f.transfers.append(f.participant,u.uploadId,32,f.bytes.subarray(32));
    assert.equal((await f.transfers.commit(f.participant,u.uploadId)).stored,true);
});
test('the shared client retains bytes on failures and verifies a matching receipt before cleanup',async()=>{
    const {uploadRecording}=await import('../../est-gui/src/shared/recording-transfer.js');
    const manifest={recordingId:'recording-1',byteLength:60,sha256:'a'.repeat(64)};
    let released=0;
    await assert.rejects(uploadRecording({manifest,readChunk:()=>new Uint8Array(32),request:async()=>{throw new Error('offline');},onReceipt:()=>released++,maxRetries:1}));
    assert.equal(released,0);
    await assert.rejects(uploadRecording({manifest,readChunk:(_id,offset,length)=>new Uint8Array(length),request:async(method,url)=>url.endsWith('complete')?{recordingId:'wrong',sha256:manifest.sha256,stored:true}:{uploadId:'upload-1',nextByteOffset:60},onReceipt:()=>released++}));
    assert.equal(released,0);
});
test('failed artifacts never satisfy the recording-completion gate',()=>{
    const context={contextKey:'attempt-1',status:'uploading',clients:[{participantId:'a'},{participantId:'b'}],files:{uploaded:new Set(['a:microphone','a:headphones']),failed:new Set(['b:microphone','b:headphones'])},sockets:{stopped:new Set(['a','b'])}};
    const state={attempts:[{attemptId:'attempt-1',status:'uploading'}],recordingContextActive:'attempt-1'};
    let completions=0;
    const core=new EffectStreamerCore({state,config:{},clientRegistry:{emitToAll:()=>{}},sessionFiles:{}});
    core.setRecordingContextCompletedHandler(()=>completions++);
    core.recordingContextFinalizeUpload(context);assert.equal(completions,0);assert.equal(context.status,'uploading');
    context.files.uploaded.add('b:microphone');context.files.uploaded.add('b:headphones');
    core.recordingContextFinalizeUpload(context);assert.equal(completions,1);assert.equal(state.recordingContextActive,null);
});
test('a late stored receipt cannot navigate an already-ended pair back into the experiment',()=>{
    const context={contextKey:'late-attempt',status:'uploading',clients:[{},{}],files:{uploaded:new Set(['a:microphone','a:headphones','b:microphone','b:headphones'])},sockets:{stopped:new Set(['a','b'])}};
    const state={phase:'ended',outcome:'technicalFailure',attempts:[{attemptId:'late-attempt',status:'uploading'}],recordingContextActive:'late-attempt'};let navigations=0;
    const core=new EffectStreamerCore({state,config:{},clientRegistry:{},sessionFiles:{}});core.setRecordingContextCompletedHandler(()=>navigations++);
    core.recordingContextFinalizeUpload(context);assert.equal(navigations,0);assert.equal(state.outcome,'technicalFailure');
});
test('authenticated HTTP uploads retry a lost final acknowledgement before releasing client bytes',async(t)=>{
    const {createCoordinator}=require('../../est-server/src/server.js');
    const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
    const {localConfig}=require('./fixtures/config.js');
    const {once}=require('node:events');
    const {uploadRecording}=await import('../../est-gui/src/shared/recording-transfer.js');
    const f=fixture(t),app=createCoordinator({config:normalizeConfig(localConfig()),root:f.root});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
    const origin='http://127.0.0.1:'+app.server.address().port;
    const a=app.enrollments.admit({identity:'client-a'}),b=app.enrollments.admit({identity:'client-b'});
    const session=app.registry.createPair([app.enrollments.get(a.participantId),app.enrollments.get(b.participantId)]);
    session.attempts.push({attemptId:'attempt-http',status:'stopping'});
    const manifest={...f.manifest,sessionId:session.sessionId,participantId:a.participantId,attemptId:'attempt-http'};
    await app.transfers.register(a,[manifest]);
    const unauthorized=await fetch(origin+'/api/recordings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(manifest)});
    assert.equal(unauthorized.status,401);
    let lost=false,released=0;
    const receipt=await uploadRecording({manifest,readChunk:(_id,offset,length)=>f.bytes.subarray(offset,offset+length),baseUrl:origin,headers:{authorization:'Bearer '+a.reconnectToken},chunkBytes:32,onReceipt:()=>released++,request:async(method,url,body,options)=>{
        const response=await fetch(url,{method,headers:{...options.headers,...(body==null?{}:{'content-type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'})},body:body==null?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
        assert.equal(response.status,200,await response.clone().text());const result=await response.json();
        if(url.endsWith('complete')&&!lost) {lost=true;throw new Error('lost final response');}
        return result;
    }});
    assert.equal(receipt.stored,true);assert.equal(released,1);assert.equal(lost,true);
    assert.deepEqual(session.attempts[0].receipts,[receipt]);
});
test('commit and duplicate recording announcement both finish without holding each others locks',async t=>{
    const {createCoordinator}=require('../../est-server/src/server.js'),{normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js'),{localConfig}=require('./fixtures/config.js');
    const {randomUUID}=require('node:crypto');const root=checkoutPaths().temporaryDirectory('est-server','est-upload-locks-');
    const app=createCoordinator({config:normalizeConfig(localConfig()),root});await app.ready;
    t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
    const people=['client-a','client-b'].map(identity=>app.enrollments.admit({identity}));
    const session=app.registry.createPair(people.map(person=>app.enrollments.get(person.participantId))),person=people[0];
    session.clientsData.get(person.participantId).socketId='lock-test';session.clientsSocketRegistry.set('lock-test',person.participantId);
    session.recordingContextActive='attempt-lock';session.attempts.push({attemptId:'attempt-lock',status:'uploading'});
    const bytes=wave(),manifest={recordingId:randomUUID(),sessionId:session.sessionId,participantId:person.participantId,attemptId:'attempt-lock',track:'microphone',filename:'microphone.wav',source:'browser-memory',contentType:'audio/wav',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'complete'};
    await app.transfers.register(person,[manifest]);await app.transfers.append(person,manifest.recordingId,0,bytes.subarray(0,32));await app.transfers.append(person,manifest.recordingId,32,bytes.subarray(32));
    for(let retry=0;retry<2;retry++){
        const committing=app.transfers.commit(person,manifest.recordingId);
        const announcing=session.dispatch(person.participantId,{version:1,requestId:randomUUID(),participantId:person.participantId,sessionId:session.sessionId,attemptId:'attempt-lock',type:'recordingsFinalized',payload:{manifests:[manifest]}});
        let timer;const result=await Promise.race([Promise.all([committing,announcing]),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1000);})]);clearTimeout(timer);
        assert.notEqual(result,null,'commit/reannouncement deadlocked');
        assert.deepEqual(session.attempts[0].receipts,[result[0]]);assert.equal(result[0].stored,true);
        assert.deepEqual(fs.readFileSync(path.join(session.sessionDir,'attempts','attempt-lock',person.participantId,'microphone.wav')),bytes);
    }
});
