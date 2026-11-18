const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {runtimeFixture,runtimeCheckout}=require('../est-core/fixtures/runtime-sdk.cjs');
const serverRoot=path.resolve(__dirname,'../../est-server');
for(const target of ['linux','win'])test(`${target} SEA build stages the runtime without needing or bundling a web build`,t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','build-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const input=runtimeFixture(root,target),bin=path.join(root,'bin'),destination=path.join(root,'dist'),capture=path.join(root,'calls.jsonl');
    const {checkout,paths}=runtimeCheckout(root,input,['common/transient-paths.sh','est-server/build_scripts/build.sh','est-core/build_scripts/stage-runtime.cjs','est-server/README.md',...['local','remote'].map(mode=>`est-server/est-server.config.${mode}.example.json`)]);
    t.after(()=>fs.rmSync(paths.base,{recursive:true,force:true}));
    const script=path.join(checkout,'est-server/build_scripts/build.sh');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin,'node'),`#!${process.execPath}\nconst fs=require('fs'),cp=require('child_process'),args=process.argv.slice(2);fs.appendFileSync(process.env.CAPTURE,JSON.stringify({args,tmp:process.env.TMPDIR})+'\\n');if(args[0].includes('/@vercel/ncc/')){const out=args[args.indexOf('-o')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/index.js','bundle');}else if(args[0]==='--experimental-sea-config'){const config=JSON.parse(fs.readFileSync(args[1]));fs.writeFileSync(config.output,'blob');}else if(args[0].includes('/postject/')){if(process.env.FAIL_INJECTION)process.exit(7);}else {const result=cp.spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit'});process.exit(result.status??1);}\n`,{mode:0o700});
    fs.writeFileSync(path.join(bin,'curl'),`#!${process.execPath}\nconst fs=require('fs'),a=process.argv;fs.writeFileSync(a[a.indexOf('-o')+1],'windows-node');\n`,{mode:0o700});
    const env={...process.env,TARGET_OS:target,SDK:input.sdk,EST_NETSIM_PLUGIN:input.netsimPlugin,EST_DISTRIBUTION_DIR:destination,PATH:bin+':'+process.env.PATH,CAPTURE:capture,NODE_VERSION:'22.22.3'};
    const result=spawnSync('bash',[script],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr+'\n'+result.stdout+'\n'+(fs.existsSync(capture)?fs.readFileSync(capture,'utf8'):''));
    const calls=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse),stage=calls.find(call=>call.args[0].endsWith('stage-runtime.cjs'));
    assert.equal(stage.args[1],path.join(destination,'core'));
    assert.ok(calls.every(call=>call.tmp.startsWith(paths.base+'/est-server/runs/')));
    assert.equal(fs.readFileSync(path.join(destination,'core/est-core'+(target==='win'?'.exe':'')),'utf8'),'source-built-core');
    assert.ok(!fs.existsSync(path.join(destination,'web')));
    for(const mode of ['local','remote']) {
        const filename=`est-server.config.${mode}.example.json`,packaged=path.join(destination,filename);
        assert.ok(fs.existsSync(packaged),`Missing ${mode}-use example: ${filename}`);
        const config=JSON.parse(fs.readFileSync(packaged,'utf8'));
        assert.equal(config.server.mode,mode);
        assert.deepEqual(config,JSON.parse(fs.readFileSync(path.join(serverRoot,filename),'utf8')));
    }
    const again=spawnSync('bash',[script],{env,encoding:'utf8'});assert.notEqual(again.status,0);assert.match(again.stderr,/overwrite|exist/i);
});
