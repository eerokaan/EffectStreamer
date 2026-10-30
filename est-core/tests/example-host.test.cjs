const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {startCore}=require('../../est-common/core-process.cjs');
const {corePath,allocatePorts}=require('./fixtures.cjs');
const {createWebRtcHost}=require('../examples/webrtc-host.cjs');

test('standalone signaling example relays an independent offer and rejects non-signaling commands', {timeout:15000},async t=>{
    const ports=await allocatePorts(t);
    const host=await createWebRtcHost({executable:corePath(),args:['--mode','sender','--device-type','webrtc','--control','ndjson','--recording','none','--peerip','127.0.0.1','--peer-port',String(ports[0]),'--echo-port',String(ports[1])]});
    t.after(()=>host.close());await host.listen(0);const url='http://127.0.0.1:'+host.server.address().port;
    const peer=await startCore({executable:path.join(path.dirname(corePath()),'webrtc-peer'),args:['sender'],timeoutMs:4000});t.after(()=>peer.stop({timeoutMs:1500}));
    const post=async body=>{const response=await fetch(url+'/signal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
    peer.on('ice-candidate',value=>{void post({type:'ice',...value});});
    const offer=await peer.request('test.offer',{}),answer=await post(offer);assert.equal(answer.status,200);assert.equal(answer.body.type,'answer');assert.match(answer.body.sdp,/m=audio/);
    await peer.request('webrtc.answer',answer.body);
    const abort=new AbortController();t.after(()=>abort.abort());
    const events=await fetch(url+'/events',{signal:abort.signal});assert.match(events.headers.get('content-type'),/text\/event-stream/);
    const reader=events.body.getReader(),decoder=new TextDecoder();let data='';
    const timer=setTimeout(()=>abort.abort(),5000);
    try {while(!data.includes('data: ')){const next=await reader.read();assert.equal(next.done,false);data+=decoder.decode(next.value);}
        const candidate=JSON.parse(data.split('data: ')[1].split('\n')[0]);assert.ok(candidate.candidate===null||typeof candidate.candidate==='string');await peer.request('webrtc.ice',candidate);
    } finally {clearTimeout(timer);abort.abort();}
    assert.equal((await post({type:'shutdown'})).status,400);
    assert.equal((await fetch(url+'/')).status,200);
});
