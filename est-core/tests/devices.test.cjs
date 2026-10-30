const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runCli,temporaryHome}=require('./fixtures.cjs');

test('native discovery produces machine-readable default input and output choices',()=>{
    const result=runCli(['--list-devices','--device-type','alsa']);
    assert.equal(result.status,0,result.stderr);
    const devices=JSON.parse(result.stdout);
    for(const kind of ['inputs','outputs']) {
        assert.ok(devices[kind].some(device=>device.id==='default'&&device.isDefault));
        assert.ok(devices[kind].every(device=>typeof device.label==='string'&&typeof device.isDefault==='boolean'));
    }
});
test('utility modes reject browser/stdio routes and missing test files before playback',()=>{
    assert.match(runCli(['--list-devices','--device-type','stdio']).stderr,/native backend/);
    assert.match(runCli(['--mode','test-output','--device-type','alsa','--test-file','/missing/P501.wav']).stderr,/test-file/);
    assert.match(runCli(['--mode','test-input','--device-type','stdio']).stderr,/native backend/);
    assert.match(runCli(['--mode','test-input','--device-type','alsa','--test-duration-ms','0']).stderr,/test-duration/);
});
test('finite native input checks release the endpoint for another check',()=>{
    for(let i=0;i<2;i++) {
        const result=runCli(['--mode','test-input','--device-type','alsa','--device-id','null','--test-duration-ms','50']);
        assert.equal(result.status,0,result.stderr);
        const resultJson=JSON.parse(result.stdout);
        assert.equal(resultJson.ok,true);assert.equal(resultJson.inputUsable,true);
        assert.ok(resultJson.peak>=0&&resultJson.peak<=1);
    }
});
test('output check decodes a real PCM WAV through the native sink',t=>{
    const directory=temporaryHome(t),file=path.join(directory,'test.wav');
    const bytes=Buffer.alloc(44+4800*2);
    bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
    bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);
    bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(9600,40);
    fs.writeFileSync(file,bytes);
    const result=runCli(['--mode','test-output','--device-type','alsa','--device-id','null','--test-file',file]);
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
});
test('invalid/unplugged native devices return a structured failure',()=>{
    const result=runCli(['--mode','test-input','--device-type','alsa','--device-id','hw:99,99','--test-duration-ms','50']);
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).ok,false);
});
test('native enumeration includes a known hardware route even when desktop audio hides ALSA', {skip:!process.env.EST_EXPECT_NATIVE_DEVICE},()=>{
    const result=runCli(['--list-devices','--device-type','alsa']);
    assert.equal(result.status,0,result.stderr);
    const devices=JSON.parse(result.stdout);
    assert.ok(devices.outputs.some(device=>device.id===process.env.EST_EXPECT_NATIVE_DEVICE));
});
