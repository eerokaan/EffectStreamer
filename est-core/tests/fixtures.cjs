const {spawn,spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const dgram = require('node:dgram');
const {checkoutPaths}=require('../../est-common/transient-paths.cjs');

function corePath() { return process.env.EST_CORE_EXECUTABLE || checkoutPaths().path('est-core','build','linux','est-core'); }
function runCli(args) { return spawnSync(corePath(),args,{encoding:'utf8',timeout:5000}); }
function temporaryHome(t) {
    const paths=checkoutPaths();
    let dir;
    if(process.env.EST_TEST_TMP){const root=paths.assertManagedOutput(process.env.EST_TEST_TMP);fs.mkdirSync(root,{recursive:true,mode:0o700});dir=fs.mkdtempSync(path.join(root,'est-core-'));}
    else dir=paths.temporaryDirectory('est-core','est-core-');
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    return dir;
}
async function allocatePorts(t,count=3) {
    const sockets=[];
    t.after(()=>{for (const socket of sockets) {try {socket.close();} catch {}}});
    for(let i=0;i<count;i++) {
        const socket=dgram.createSocket('udp4'); sockets.push(socket);
        await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',resolve);});
    }
    const ports=sockets.map(socket=>socket.address().port);
    await Promise.all(sockets.map(socket=>new Promise(resolve=>socket.close(resolve))));
    sockets.length=0;
    return ports;
}
function startProcess(t,args,{home=temporaryHome(t)}={}) {
    const child=spawn(corePath(),args,{env:{...process.env,HOME:home},stdio:['pipe','pipe','pipe']});
    let stderr='',stdout=Buffer.alloc(0);
    child.stderr.on('data',chunk=>stderr+=chunk.toString());
    child.stdout.on('data',chunk=>{stdout=Buffer.concat([stdout,chunk]);});
    child.stdin.on('error',()=>{});
    const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stderr,stdout}));});
    t.after(async()=>{if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');await exit;});
    return {child,exit,get stderr(){return stderr;},get stdout(){return stdout;}};
}
function waitForReady(record,role,timeoutMs=5000) {
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('Ready timeout: '+record.stderr)),timeoutMs);
        const check=()=>{if(record.stderr.includes('EST_CORE_READY '+role)) finish();};
        const finish=(error)=>{clearTimeout(timer);record.child.stderr.off('data',check);error?reject(error):resolve();};
        record.child.stderr.on('data',check);
        record.exit.then(result=>finish(new Error('Exited before ready: '+result.stderr)),finish);
        check();
    });
}
function feedRtp(t,ports,{value=8192}={}) {
    const socket=dgram.createSocket('udp4');
    let seq=0;
    const send=()=>{
        const packet=Buffer.alloc(12+480*2);packet[0]=0x80;packet[1]=96;
        packet.writeUInt16BE(seq%65536,2);packet.writeUInt32BE((seq*480)>>>0,4);packet.writeUInt32BE(1234,8);
        for(let i=12;i<packet.length;i+=2) packet.writeInt16BE(value,i);
        seq++;
        for(const port of ports) socket.send(packet,port,'127.0.0.1');
    };
    const timer=setInterval(send,10);
    const stop=()=>{clearInterval(timer);try{socket.close();}catch{}};
    t.after(stop);send();return stop;
}
module.exports={corePath,runCli,temporaryHome,allocatePorts,startProcess,waitForReady,feedRtp};
