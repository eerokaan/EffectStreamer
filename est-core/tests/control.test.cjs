const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runCli,allocatePorts,startProcess,feedRtp}=require('./fixtures.cjs');
const {startCore}=require('../../est-common/core-process.cjs');
const {corePath,temporaryHome}=require('./fixtures.cjs');

test('raw stdio explicitly rejects control framing',()=>{
    const r=runCli(['--mode','receiver','--device-type','stdio','--control','ndjson']);
    assert.equal(r.status,1);assert.match(r.stderr,/incompatible.*stdio/i);
});
async function managed(t) {
    const ports=await allocatePorts(t);
    const core=await startCore({executable:corePath(),args:['--mode','receiver','--device-type','alsa','--device-id','null','--control','ndjson','--listen-port',String(ports[0]),'--echo-port',String(ports[1]),'--record-port',String(ports[2])],env:{...process.env,HOME:temporaryHome(t)},timeoutMs:3000});
    t.after(()=>core.stop({timeoutMs:3000}));
    return {core,ports};
}
test('native control is ready without audio and repeated stop finalizes and exits', {timeout:10000},async(t)=>{
    const {core,ports}=await managed(t);
    const ready=[];core.on('media-ready',event=>ready.push(event));
    await assert.rejects(core.request('webrtc.offer',{type:'offer',sdp:'bad'}),/unsupported/i);
    await core.request('audio.start',{});
    assert.equal(ready.length,0,'a start acknowledgement is not evidence of received media');
    const flowing=new Promise(resolve=>core.on('media-ready',resolve));
    feedRtp(t,ports);await flowing;
    await Promise.all([core.request('audio.stop',{}),core.request('audio.stop',{})]);
    await core.stop({timeoutMs:3000});assert.equal(core.child.exitCode,0);
});
test('control tolerates split requests, rejects bad JSON/oversized input and stops on EOF', {timeout:10000},async(t)=>{
    const {core}=await managed(t);
    const events=[];core.on('protocol-error',error=>events.push(error));
    core.child.stdin.write('{"version":1,"type":"request","id":"split",');
    core.child.stdin.write('"command":"audio.start","payload":{}}\n');
    core.child.stdin.write('{not-json}\n'+'x'.repeat(1048577)+'\n');
    await core.request('audio.start',{});
    core.child.stdin.end();
    const result=await core.exited;assert.equal(result.code,0);
    assert.equal(events.length,2);
});
