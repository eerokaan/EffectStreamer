const {test} = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const {spawnSync}=require('node:child_process');
const {corePath}=require('./fixtures.cjs');
const {runCli,allocatePorts,startProcess,waitForReady,feedRtp} = require('./fixtures.cjs');

test('help preserves standalone modes and documents configurable ports',()=>{
    const result=runCli(['--help']);assert.equal(result.status,0);
    assert.match(result.stderr,/--peer-port/);assert.match(result.stderr,/--listen-port/);
});
test('port validation rejects invalid ranges and role-specific options before opening audio',()=>{
    for (const value of ['0','65536','-1','2.5','garbage']) {
        const result=runCli(['--mode','sender','--device-type','stdio','--peerip','127.0.0.1','--peer-port',value]);
        assert.equal(result.status,1);assert.match(result.stderr,/Invalid.*--peer-port/);
    }
    for (const [role,option] of [['sender','--listen-port'],['receiver','--peer-port']]) {
        const result=runCli(['--mode',role,'--device-type','stdio',option,'12345']);
        assert.equal(result.status,1);assert.match(result.stderr,/only supported/);
    }
    assert.match(runCli(['--mode','receiver','--device-type','stdio','--bind-address','bad']).stderr,/Invalid.*--bind-address/);
    assert.match(runCli(['--mode','receiver','--device-type','stdio','--device-id','browser-id']).stderr,/invalid with/);
});
test('sender exits gracefully when stdin closes before the first audio buffer',()=>{
    for(let i=0;i<20;i++) {
        const result=spawnSync(corePath(),['--mode','sender','--device-type','stdio','--peerip','127.0.0.1'],{encoding:'utf8',input:'',timeout:1500});
        assert.equal(result.status,0,result.stderr+' '+result.error);
    }
});
test('two silent-independent receivers bind distinct endpoint sets and release on EOF', {timeout:15000},async(t)=>{
    const ports=await allocatePorts(t,6);
    const records=[0,3].map(i=>startProcess(t,['--mode','receiver','--device-type','stdio','--bind-address','127.0.0.1','--listen-port',String(ports[i]),'--echo-port',String(ports[i+1]),'--record-port',String(ports[i+2])]));
    feedRtp(t,ports);
    await Promise.all(records.map(record=>waitForReady(record,'receiver')));
    for(const record of records) record.child.stdin.end();
    for(const record of records) {const result=await record.exit;assert.equal(result.code,0,result.stderr);}
});
test('a receiver cannot silently reuse an occupied endpoint', {timeout:10000},async(t)=>{
    const ports=await allocatePorts(t);
    const args=['--mode','receiver','--device-type','stdio','--listen-port',String(ports[0]),'--echo-port',String(ports[1]),'--record-port',String(ports[2])];
    const first=startProcess(t,args);feedRtp(t,ports);await waitForReady(first,'receiver');
    const second=startProcess(t,args);const result=await second.exit;
    assert.equal(result.code,1);assert.match(result.stderr,/bind|Address already in use/i);
    first.child.stdin.end();assert.equal((await first.exit).code,0);
});

test('sender sends L16 to the configured peer, echo, and recording endpoints', {timeout:10000},async(t)=>{
    const sockets=Array.from({length:3},()=>dgram.createSocket('udp4'));
    t.after(()=>{for(const socket of sockets) {try{socket.close();}catch{}}});
    await Promise.all(sockets.map(socket=>new Promise(resolve=>socket.bind(0,'127.0.0.1',resolve))));
    const received=sockets.map(socket=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Missing RTP on '+socket.address().port)),5000);
        socket.once('message',packet=>{clearTimeout(timer);resolve(packet);});
    }));
    const ports=sockets.map(socket=>socket.address().port);
    const sender=startProcess(t,['--mode','sender','--device-type','stdio','--peerip','127.0.0.1','--peer-port',String(ports[0]),'--echo-port',String(ports[1]),'--record-port',String(ports[2])]);
    const pcm=Buffer.alloc(4800*4);for(let i=0;i<pcm.length;i+=4) pcm.writeFloatLE(0.25,i);
    sender.child.stdin.end(pcm);
    const packets=await Promise.all(received);
    assert.ok(packets.every(packet=>(packet[1]&127)===96));
    for(const packet of packets) assert.ok(Math.abs(packet.readInt16BE(12)-8192)<=1);
    let exitTimer;
    try {
        const result=await Promise.race([sender.exit,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(new Error('Sender exit stalled after RTP delivery: '+sender.stderr)),4000);})]);
        assert.equal(result.code,0,result.stderr);
    } finally {clearTimeout(exitTimer);}
});
