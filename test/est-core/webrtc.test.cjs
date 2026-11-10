const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startCore}=require('../../common/core-process.cjs');
const {runCli,corePath,allocatePorts,temporaryHome}=require('./fixtures.cjs');
const path=require('node:path');

async function negotiate(t,role,{tone=false}={}) {
    const ports=await allocatePorts(t);
    const args=['--mode',role,'--device-type','webrtc','--control','ndjson','--recording','none','--ice-min-port','45000','--ice-max-port','45050','--echo-port',String(ports[1]),'--record-port',String(ports[2]),...(role==='sender'?['--peerip','127.0.0.1','--peer-port',String(ports[0])]:['--bind-address','127.0.0.1','--listen-port',String(ports[0])])];
    const core=await startCore({executable:corePath(),args,env:{...process.env,HOME:temporaryHome(t)},timeoutMs:5000});
    const peer=await startCore({executable:path.join(path.dirname(corePath()),'webrtc-peer'),args:[role==='sender'?'sender':'receiver',...(tone?['tone']:[])],timeoutMs:5000});
    t.after(async()=>{try {await core.stop({timeoutMs:7000});} finally {await peer.stop({timeoutMs:1000});}});
    const errors=[],candidates=[];
    core.on('ice-candidate',candidate=>{candidates.push(candidate);void peer.request('webrtc.ice',candidate).catch(error=>errors.push(error.message));});
    peer.on('ice-candidate',candidate=>{void core.request('webrtc.ice',candidate).catch(error=>errors.push(error.message));});
    const offer=await peer.request('test.offer',{});
    const answer=await core.request('webrtc.offer',offer);
    assert.equal(answer.type,'answer');assert.match(answer.sdp,/109 opus\/48000\/2/i);
    await peer.request('webrtc.answer',answer);
    return {core,peer,ports,errors,candidates};
}

test('WebRTC requires managed signaling and rejects native device IDs',()=>{
    assert.match(runCli(['--mode','receiver','--device-type','webrtc']).stderr,/requires.*ndjson/i);
    assert.match(runCli(['--mode','receiver','--device-type','webrtc','--control','ndjson','--device-id','default']).stderr,/device-id.*invalid/i);
    assert.match(runCli(['--mode','receiver','--device-type','webrtc','--control','ndjson','--ice-min-port','60000','--ice-max-port','50000']).stderr,/ICE.*range/i);
});
test('WebRTC priming sends only silence until audio.start releases microphone content', {timeout:15000},async(t)=>{
    const {core,ports}=await negotiate(t,'sender',{tone:true});
    const dgram=require('node:dgram'), socket=dgram.createSocket('udp4');
    t.after(()=>socket.close());await new Promise(resolve=>socket.bind(ports[0],'127.0.0.1',resolve));
    const packet=()=>new Promise(resolve=>socket.once('message',resolve));
    const silent=packet();await core.request('audio.prime',{});
    const primed=await silent;const samples=Array.from({length:(primed.length-12)/2},(_,index)=>primed.readInt16BE(12+index*2));
    assert.ok(samples.every(value=>value===0),'Priming sample values: '+samples.slice(0,16)+'; absolute peak '+Math.max(...samples.map(Math.abs)));
    for(let index=0;index<10;index++){const next=await packet();assert.ok(next.subarray(12).every(value=>value===0),'All pre-start packets must remain silent');}
    const audible=new Promise(resolve=>{const listener=bytes=>{if(bytes.subarray(12).some(value=>value!==0)){socket.off('message',listener);resolve(bytes);}};socket.on('message',listener);});
    await core.request('audio.start',{});assert.ok((await audible).length>12);
});
test('a negotiated sender can stop before audio.start without a gate swallowing EOS', {timeout:10000},async(t)=>{
    const {core}=await negotiate(t,'sender');await core.stop({timeoutMs:7000});assert.equal(core.child.exitCode,0);
});
test('a GStreamer offerer sends silent Opus to the sender backend and produces internal L16', {timeout:20000},async(t)=>{
    const {core,ports,candidates}=await negotiate(t,'sender');
    const dgram=require('node:dgram');const socket=dgram.createSocket('udp4');
    t.after(()=>socket.close());await new Promise(resolve=>socket.bind(ports[0],'127.0.0.1',resolve));
    const received=new Promise(resolve=>socket.once('message',resolve));
    await core.request('audio.start',{});
    const packet=await received;assert.equal(packet[1]&127,96);assert.equal(packet.length,12+128*2,'WebRTC frame sizes must not change internal loss-packet granularity');
    const udp=candidates.filter(value=>value.candidate&&/ udp /i.test(value.candidate));assert.ok(udp.length);
    assert.ok(udp.every(value=>{const port=Number(value.candidate.split(' ')[5]);return port>=45000&&port<=45050;}));
});
test('native discontinuities preserve partial PCM blocks instead of dropping audio to force packet size', {timeout:10000},async(t)=>{
    const dgram=require('node:dgram');const socket=dgram.createSocket('udp4');
    t.after(()=>socket.close());await new Promise(resolve=>socket.bind(0,'127.0.0.1',resolve));
    const core=await startCore({executable:corePath(),args:['--mode','sender','--device-type','alsa','--device-id','null','--control','ndjson','--recording','none','--peerip','127.0.0.1','--peer-port',String(socket.address().port)],timeoutMs:3000});
    t.after(()=>core.stop({timeoutMs:7000}));
    const packets=new Promise(resolve=>{const values=[];socket.on('message',packet=>{values.push(packet.length);if(values.length===20) resolve(values);});});
    await core.request('audio.start',{});
    const lengths=await packets;
    // ALSA null is unclocked and marks every 1 ms capture buffer discontinuous.
    // Keeping its 48-frame partial blocks is intentional; do not pad/drop them.
    assert.ok(lengths.includes(108),'Native partial blocks: '+lengths.join(','));
    assert.ok(lengths.every(length=>length>12&&length<=268&&(length-12)%2===0));
});
test('the receiver backend sends the received mix as negotiated Opus to a GStreamer peer', {timeout:20000},async(t)=>{
    const {core,peer,ports}=await negotiate(t,'receiver');
    const {feedRtp}=require('./fixtures.cjs');
    const playing=new Promise(resolve=>peer.on('media-ready',resolve));
    await core.request('audio.start',{});feedRtp(t,ports.slice(0,2));await playing;
});
test('both WebRTC roles are controllable before any media, reject malformed SDP and stop before negotiation', {timeout:20000},async(t)=>{
    for(const mode of ['sender','receiver']) {
        const ports=await allocatePorts(t);
        const core=await startCore({executable:corePath(),args:['--mode',mode,'--device-type','webrtc','--control','ndjson','--recording','none','--echo-port',String(ports[1]),'--record-port',String(ports[2]),...(mode==='sender'?['--peerip','127.0.0.1','--peer-port',String(ports[0])]:['--bind-address','127.0.0.1','--listen-port',String(ports[0])])],env:{...process.env,HOME:temporaryHome(t)},timeoutMs:3000});
        t.after(()=>core.stop({timeoutMs:7000}));
        await assert.rejects(core.request('webrtc.offer',{type:'offer',sdp:'not SDP'}),/SDP|Opus|audio/i);
        await assert.rejects(core.request('webrtc.ice',{candidate:'not a candidate',sdpMLineIndex:0}),/candidate/);
        await core.request('webrtc.ice',{candidate:'candidate:1 1 UDP 2130706431 127.0.0.1 45000 typ host',sdpMLineIndex:0});
        await core.request('webrtc.ice',{candidate:null,sdpMLineIndex:0});
        await core.stop({timeoutMs:7000});assert.equal(core.child.exitCode,0);
    }
});
test('stopping with an offer in flight cancels asynchronous callbacks without a stale process', {timeout:15000},async(t)=>{
    const ports=await allocatePorts(t);
    const core=await startCore({executable:corePath(),args:['--mode','sender','--device-type','webrtc','--control','ndjson','--recording','none','--peerip','127.0.0.1','--peer-port',String(ports[0]),'--echo-port',String(ports[1])],timeoutMs:3000});
    const peer=await startCore({executable:path.join(path.dirname(corePath()),'webrtc-peer'),args:['sender'],timeoutMs:3000});
    t.after(async()=>{try{await core.stop({timeoutMs:7000});}finally{await peer.stop({timeoutMs:1000});}});
    const offer=await peer.request('test.offer',{});
    const pending=core.request('webrtc.offer',offer).catch(error=>({cancelled:error.message}));
    await core.stop({timeoutMs:7000});await pending;
    assert.equal(core.child.exitCode,0);
    await assert.rejects(core.request('webrtc.ice',{candidate:null,sdpMLineIndex:0}),/closed/);
});
