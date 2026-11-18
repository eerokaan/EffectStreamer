const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {RecordingTransfers}=require('../../est-server/src/services/RecordingTransfers.js');
async function fixture(t) {
    const root=checkoutPaths().temporaryDirectory('est-server','upload-paths-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const bytes=Buffer.from('524946462800000057415645666d7420100000000100010080bb00000077010002001000646174610400000000200020','hex');
    const person={participantId:'person-a'},session={sessionId:'session-1',sessionDir:path.join(root,'session-1'),clientsData:new Map([['person-a',person]]),attempts:[{attemptId:'attempt-1',status:'uploading'}],persist:async()=>{}};
    const manifest={recordingId:'recording-1',sessionId:'session-1',participantId:'person-a',attemptId:'attempt-1',track:'microphone',filename:'microphone.wav',source:'local-file',contentType:'audio/wav',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'complete'};
    const options={root,getSession:()=>session,config:{chunkBytes:64,maxBytesPerParticipant:100000,uploadTimeoutMs:10000}};
    const transfers=new RecordingTransfers(options);await transfers.register(person,[manifest]);
    const legacy=path.join(root,'.uploads','recording-1.part'),final=path.join(session.sessionDir,'attempts','attempt-1','person-a','microphone.wav');
    return {root,bytes,person,session,manifest,options,transfers,legacy,final};
}
for(const count of [20,48]) test(`unowned ${count}-byte partial file is ignored and survives a current upload`,async t=>{
    const f=await fixture(t);fs.writeFileSync(f.legacy,f.bytes.subarray(0,count));
    t.mock.method(fs.promises,'rename',()=>{throw new Error('publication rename forbidden');});
    assert.equal((await f.transfers.begin(f.person,f.manifest)).nextByteOffset,0);
    assert.equal(fs.existsSync(f.final),false);
    await f.transfers.append(f.person,'recording-1',0,f.bytes);
    assert.equal((await f.transfers.commit(f.person,'recording-1')).stored,true);
    assert.deepEqual(fs.readFileSync(f.legacy),f.bytes.subarray(0,count));assert.deepEqual(fs.readFileSync(f.final),f.bytes);
});
test('commit cannot certify an absent canonical WAV using a complete unowned partial file',async t=>{
    const f=await fixture(t);fs.writeFileSync(f.legacy,f.bytes);
    await assert.rejects(f.transfers.commit(f.person,'recording-1'),/ENOENT|Incomplete/);
    assert.equal(fs.existsSync(f.final),false);
    assert.deepEqual(fs.readFileSync(f.legacy),f.bytes);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'.uploads','recording-1.json'))).receipt,undefined);
});
for(const count of [10,30]) test(`resume uses only the canonical ${count}-byte prefix despite conflicting old bytes`,async t=>{
    const f=await fixture(t);fs.writeFileSync(f.legacy,Buffer.alloc(20,255));
    fs.mkdirSync(path.dirname(f.final),{recursive:true});fs.writeFileSync(f.final,f.bytes.subarray(0,count));
    assert.equal((await f.transfers.begin(f.person,f.manifest)).nextByteOffset,count);
    await f.transfers.append(f.person,'recording-1',count,f.bytes.subarray(count));
    assert.equal((await f.transfers.commit(f.person,'recording-1')).stored,true);
    assert.deepEqual(fs.readFileSync(f.final),f.bytes);assert.deepEqual(fs.readFileSync(f.legacy),Buffer.alloc(20,255));
});
test('failed receipt reconciliation retains canonical audio for a successful retry',async t=>{
    const f=await fixture(t);await f.transfers.append(f.person,'recording-1',0,f.bytes);
    const broken=new RecordingTransfers({...f.options,onReceipt:async()=>{throw new Error('session write failed');}});
    await broken.begin(f.person,f.manifest);await assert.rejects(broken.commit(f.person,'recording-1'),/session write failed/);
    assert.deepEqual(fs.readFileSync(f.final),f.bytes);
    assert.equal((await f.transfers.commit(f.person,'recording-1')).stored,true);
});
test('failed direct receipt persistence retains canonical audio and fails closed on truncated metadata',async t=>{
    const f=await fixture(t);await f.transfers.append(f.person,'recording-1',0,f.bytes);
    const open=fs.promises.open.bind(fs.promises),metadata=path.join(f.root,'.uploads','recording-1.json');
    t.mock.method(fs.promises,'open',async(name,...args)=>{
        const handle=await open(name,...args);
        if(name===metadata && typeof args[0]==='number' && (args[0]&fs.constants.O_WRONLY)) {
            const write=handle.writeFile.bind(handle);handle.writeFile=async()=>{await write('{');throw new Error('receipt disk failure');};
        }
        return handle;
    });
    await assert.rejects(f.transfers.commit(f.person,'recording-1'),/receipt disk failure/);
    assert.deepEqual(fs.readFileSync(f.final),f.bytes);
    await assert.rejects(f.transfers.begin(f.person,f.manifest));
});
test('recording writes reject symlinked session ancestors instead of escaping the authorized session',async t=>{
    const f=await fixture(t),outside=path.join(f.root,'other-session');fs.mkdirSync(outside);fs.mkdirSync(f.session.sessionDir);
    fs.symlinkSync(outside,path.join(f.session.sessionDir,'attempts'));
    await assert.rejects(f.transfers.append(f.person,'recording-1',0,f.bytes),/symlink|directory|confined/i);
    assert.deepEqual(fs.readdirSync(outside),[]);
});
for(const kind of ['symlink','hardlink'])test(`commit never certifies a ${kind} to another recording`,async t=>{
    const f=await fixture(t),outside=path.join(f.root,'other.wav');fs.writeFileSync(outside,f.bytes);
    fs.mkdirSync(path.dirname(f.final),{recursive:true});
    if(kind==='symlink')fs.symlinkSync(outside,f.final);else fs.linkSync(outside,f.final);
    await assert.rejects(f.transfers.commit(f.person,'recording-1'),/linked|regular|symlink|ELOOP/i);
    const metadata=JSON.parse(fs.readFileSync(path.join(f.root,'.uploads','recording-1.json')));assert.equal(metadata.receipt,undefined);
});
test('upload metadata directory cannot be a symlink outside the results root',async t=>{
    const f=await fixture(t),root=path.join(f.root,'new-root'),outside=path.join(f.root,'outside-metadata');
    fs.mkdirSync(root);fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'.uploads'));
    assert.throws(()=>new RecordingTransfers({...f.options,root}),/symlink|directory/i);
    assert.deepEqual(fs.readdirSync(outside),[]);
});
test('mid-append disk failure resumes from the canonical written prefix',async t=>{
    const f=await fixture(t);const open=fs.promises.open.bind(fs.promises);
    const mocked=t.mock.method(fs.promises,'open',async(name,...args)=>{
        const handle=await open(name,...args);
        if(name===f.final){const write=handle.write.bind(handle);handle.write=async(bytes,offset,length,position)=>{await write(bytes,offset,Math.min(length,12),position);throw new Error('append disk failure');};}
        return handle;
    });
    await assert.rejects(f.transfers.append(f.person,'recording-1',0,f.bytes),/append disk failure/);
    assert.deepEqual(fs.readFileSync(f.final),f.bytes.subarray(0,12));
    mocked.mock.restore();assert.equal((await f.transfers.begin(f.person,f.manifest)).nextByteOffset,12);
    await f.transfers.append(f.person,'recording-1',12,f.bytes.subarray(12));
    assert.equal((await f.transfers.commit(f.person,'recording-1')).stored,true);
});
