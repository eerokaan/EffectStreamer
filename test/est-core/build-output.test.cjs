const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const script=path.resolve(__dirname,'build.sh');
const productionScript=path.resolve(__dirname,'../../est-core/build_scripts/build.sh');
function fixture(t) {
    const paths=checkoutPaths(),root=paths.temporaryDirectory('est-core','compiler-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.mkdirSync(path.join(root,'sdk/include/gstreamer-1.0'),{recursive:true});fs.mkdirSync(path.join(root,'bin'));
    const cc=path.join(root,'compiler'),capture=path.join(root,'compile.jsonl');
    fs.writeFileSync(cc,`#!${process.execPath}\nrequire('fs').appendFileSync(process.env.CAPTURE,JSON.stringify({args:process.argv.slice(2),tmp:process.env.TMPDIR})+'\\n');\n`,{mode:0o700});
    fs.writeFileSync(path.join(root,'bin/pkg-config'),'#!/usr/bin/env bash\nif [[ "$1" == --modversion ]]; then echo 1.28.7; fi\n',{mode:0o700});
    const env={...process.env,SDK:path.join(root,'sdk'),CC:cc,CAPTURE:capture,PATH:path.join(root,'bin')+':'+process.env.PATH};
    delete env.EST_CORE_OUTPUT;return {root,paths,capture,env};
}
for(const target of ['linux','win']) test(`${target} core and peer compile into managed output paths with managed compiler scratch`,t=>{
    const f=fixture(t),result=spawnSync('bash',[script],{cwd:'/',env:{...f.env,TARGET_OS:target},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const calls=fs.readFileSync(f.capture,'utf8').trim().split('\n').map(JSON.parse),suffix=target==='win'?'.exe':'';
    assert.equal(calls[0].args.at(-1),f.paths.base+`/est-core/build/${target}/est-core${suffix}`);
    assert.equal(calls[1].args.at(-1),f.paths.base+`/est-core/build/${target}/webrtc-peer${suffix}`);
    for(const name of ['webrtc-peer.c','peer-support.c'])assert.ok(calls[1].args.includes(path.join(__dirname,'fixtures',name)));
    assert.ok(calls.every(call=>call.tmp.startsWith(f.paths.base+'/est-core/runs/')));
});
test('the production build compiles only the application, without test fixtures',t=>{
    const f=fixture(t),result=spawnSync('bash',[productionScript],{env:{...f.env,EST_BUILD_TEST_PEER:'1'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const calls=fs.readFileSync(f.capture,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length,1);
});
test('explicit outputs with spaces are managed and outside outputs are rejected',t=>{
    const f=fixture(t),output=path.join(f.root,'space here','custom-core');
    let result=spawnSync('bash',[script],{env:{...f.env,EST_CORE_OUTPUT:output},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const calls=fs.readFileSync(f.capture,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls[0].args.at(-1),output);assert.equal(calls[1].args.at(-1),path.join(path.dirname(output),'webrtc-peer'));
    result=spawnSync('bash',[script],{env:{...f.env,EST_CORE_OUTPUT:'/outside/core'},encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/managed|transient/i);
});
test('a second stable-output build refuses the existing build lock',t=>{
    const f=fixture(t),release=f.paths.acquireLock('est-core','linux');t.after(release);
    const result=spawnSync('bash',[script],{env:f.env,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/lock/i);
});
test('custom test homes create private intermediate directories inside the managed namespace',t=>{
    const f=fixture(t),root=path.join(f.root,'override','nested'),old=process.env.EST_TEST_TMP;
    process.env.EST_TEST_TMP=root;
    try {
        const home=require('./fixtures.cjs').temporaryHome(t);
        assert.ok(home.startsWith(root+path.sep));assert.equal(fs.statSync(path.dirname(root)).mode & 0o777,0o700);
    } finally {if(old===undefined)delete process.env.EST_TEST_TMP;else process.env.EST_TEST_TMP=old;}
});
