const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {corePath,allocatePorts,startProcess,waitForReady,feedRtp,temporaryHome,runCli}=require('./fixtures.cjs');
const {startCore}=require('../../common/core-process.cjs');

function wav(bytes) {
    assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
    assert.equal(bytes.readUInt32LE(4),bytes.length-8);
    let format,data;
    for(let offset=12;offset+8<=bytes.length;) {
        const name=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);
        assert.ok(offset+8+size<=bytes.length,'chunk length within the file');
        if(name==='fmt ') format=bytes.subarray(offset+8,offset+8+size);
        if(name==='data') data=bytes.subarray(offset+8,offset+8+size);
        offset+=8+size+(size%2);
    }
    assert.ok(format);assert.ok(data);
    assert.equal(format.readUInt16LE(0),1);assert.equal(format.readUInt16LE(2),1);
    assert.equal(format.readUInt32LE(4),48000);assert.equal(format.readUInt16LE(14),16);
    return data;
}
async function receiving(t,args) {
    const home=temporaryHome(t),ports=await allocatePorts(t);
    const record=startProcess(t,['--mode','receiver','--device-type','stdio','--listen-port',String(ports[0]),'--echo-port',String(ports[1]),'--record-port',String(ports[2]),...args(home)],{home});
    feedRtp(t,ports.slice(0,2),{value:8192});feedRtp(t,ports.slice(2),{value:4096});
    await waitForReady(record,'receiver');
    if(record.stdout.length<4096) await new Promise(resolve=>{const check=()=>{if(record.stdout.length>=4096){record.child.stdout.off('data',check);resolve();}};record.child.stdout.on('data',check);check();});
    record.child.stdin.end();
    return {home,result:await record.exit};
}
test('native taps produce separate finalized PCM WAV files without timing sidecars', {timeout:10000},async(t)=>{
    const {home,result}=await receiving(t,home=>['--recording','wav','--recording-dir',path.join(home,'attempt-1')]);
    assert.equal(result.code,0,result.stderr);
    const directory=path.join(home,'attempt-1');
    assert.deepEqual(fs.readdirSync(directory).sort(),['headphones.wav','microphone.wav']);
    for(const [name,value] of [['microphone',4096],['headphones',8192]]) {
        const data=wav(fs.readFileSync(path.join(directory,name+'.wav')));
        const samples=Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2));
        assert.ok(samples.some(sample=>Math.abs(sample-value)<=1),`${name} contains its own tap signal`);
    }
});
test('disabled recording creates neither files nor the requested directory', {timeout:10000},async(t)=>{
    const {home,result}=await receiving(t,home=>['--recording','none','--recording-dir',path.join(home,'unused')]);
    assert.equal(result.code,0,result.stderr);assert.equal(fs.existsSync(path.join(home,'unused')),false);
    assert.equal(fs.existsSync(path.join(home,'effectstreamer')),false);
});
test('an unusable recording destination fails explicitly instead of silently losing recordings', {timeout:10000},async(t)=>{
    const home=temporaryHome(t),ports=await allocatePorts(t);
    const file=path.join(home,'not-directory');fs.writeFileSync(file,'keep');
    const record=startProcess(t,['--mode','receiver','--device-type','stdio','--listen-port',String(ports[0]),'--echo-port',String(ports[1]),'--record-port',String(ports[2]),'--recording-dir',path.join(file,'attempt')],{home});
    const result=await record.exit;assert.equal(result.code,1);assert.match(result.stderr,/recording directory/i);
    assert.equal(fs.readFileSync(file,'utf8'),'keep');
});
test('recording policy rejects unsupported encodings and empty directories',()=>{
    assert.match(runCli(['--mode','receiver','--device-type','stdio','--recording','opus']).stderr,/Invalid.*--recording/);
    assert.match(runCli(['--mode','receiver','--device-type','stdio','--recording-dir','']).stderr,/recording-dir.*empty/);
});
test('forced termination never certifies partial recordings as finalized', {timeout:10000},async(t)=>{
    const ports=await allocatePorts(t),home=temporaryHome(t);
    const core=await startCore({executable:corePath(),args:['--mode','receiver','--device-type','alsa','--device-id','null','--control','ndjson','--listen-port',String(ports[0]),'--echo-port',String(ports[1]),'--record-port',String(ports[2]),'--recording-dir',home],env:{...process.env,HOME:home}});
    t.after(async()=>{if(core.child.exitCode===null&&core.child.signalCode===null) await core.stop();});
    const finalized=[];core.on('recording-finalized',event=>finalized.push(event));
    const flowing=new Promise(resolve=>core.on('media-ready',resolve));
    await core.request('audio.start',{});feedRtp(t,ports);await flowing;
    core.child.kill('SIGKILL');const result=await core.exited;
    assert.equal(result.signal,'SIGKILL');assert.equal(finalized.length,0);
    await assert.rejects(core.stop(),/unsuccessfully/);
});
