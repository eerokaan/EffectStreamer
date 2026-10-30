const {test}=require('node:test');
const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const {startProcess}=require('./fixtures.cjs');

test('100 percent experimental loss drops only the private peer branch and preserves the echo signal',{skip:!process.env.EST_NETSIM_INTEGRATION,timeout:10000},async t=>{
    const peer=dgram.createSocket('udp4'),echo=dgram.createSocket('udp4');t.after(()=>{peer.close();echo.close();});
    await Promise.all([peer,echo].map(socket=>new Promise(resolve=>socket.bind(0,'127.0.0.1',resolve))));
    const received=[];peer.on('message',packet=>received.push(packet));const heard=new Promise(resolve=>echo.once('message',resolve));
    const source=startProcess(t,['--mode','sender','--device-type','stdio','--recording','none','--peerip','127.0.0.1','--peer-port',String(peer.address().port),'--echo-port',String(echo.address().port),'--packetloss-type','random','--packetloss-ratio','1','--packetloss-seed','12']);
    const pcm=Buffer.alloc(4800*4);for(let index=0;index<4800;index++)pcm.writeFloatLE(.25,4*index);source.child.stdin.end(pcm);
    const [packet,result]=await Promise.all([heard,source.exit]);assert.equal(result.code,0,result.stderr);assert.equal(packet[1]&127,96);assert.ok(Math.abs(packet.readInt16BE(12)-8192)<=1);
    await new Promise(resolve=>setTimeout(resolve,50));assert.equal(received.length,0);
});
