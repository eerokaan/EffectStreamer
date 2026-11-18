const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {runtimeFixture}=require('../est-core/fixtures/runtime-sdk.cjs');
const script=path.resolve(__dirname,'../../est-server/build_scripts/build.sh');
for(const target of ['linux','win'])test(`${target} SEA build writes final resources directly and uses managed build inputs`,t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','build-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const input=runtimeFixture(root,target),bin=path.join(root,'bin'),web=path.join(root,'web'),destination=path.join(root,'dist'),capture=path.join(root,'calls.jsonl');
    fs.mkdirSync(bin);fs.mkdirSync(path.join(web,'audio'),{recursive:true});fs.writeFileSync(path.join(web,'index.html'),'web');
    for (const language of ['german','english']) fs.writeFileSync(path.join(web,`audio/P501_C_${language}_f1_FB_48k.wav`),language+'-wav');
    fs.writeFileSync(path.join(bin,'node'),`#!${process.execPath}\nconst fs=require('fs'),cp=require('child_process'),args=process.argv.slice(2);fs.appendFileSync(process.env.CAPTURE,JSON.stringify({args,core:process.env.EST_CORE_EXECUTABLE,tmp:process.env.TMPDIR})+'\\n');if(args[0].includes('/@vercel/ncc/')){const out=args[args.indexOf('-o')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/index.js','bundle');}else if(args[0]==='--experimental-sea-config'){const config=JSON.parse(fs.readFileSync(args[1]));fs.writeFileSync(config.output,'blob');}else if(args[0].includes('/postject/')){if(process.env.FAIL_INJECTION)process.exit(7);}else {const result=cp.spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit',env:{...process.env,EST_CORE_EXECUTABLE:process.env.FIXTURE_CORE}});process.exit(result.status??1);}\n`,{mode:0o700});
    fs.writeFileSync(path.join(bin,'curl'),`#!${process.execPath}\nconst fs=require('fs'),a=process.argv;fs.writeFileSync(a[a.indexOf('-o')+1],'windows-node');\n`,{mode:0o700});
    const env={...process.env,TARGET_OS:target,SDK:input.sdk,EST_NETSIM_PLUGIN:input.netsimPlugin,EST_WEB_ROOT:web,EST_DISTRIBUTION_DIR:destination,PATH:bin+':'+process.env.PATH,CAPTURE:capture,FIXTURE_CORE:input.executable,NODE_VERSION:'22.22.3'};
    delete env.EST_CORE_EXECUTABLE;
    const result=spawnSync('bash',[script],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr+'\n'+result.stdout+'\n'+(fs.existsSync(capture)?fs.readFileSync(capture,'utf8'):''));
    const calls=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse),stage=calls.find(call=>call.args[0].endsWith('stage-runtime.cjs'));
    assert.equal(stage.args[1],path.join(destination,'core'));assert.equal(stage.core,checkoutPaths().path('est-core','build',target,'est-core'+(target==='win'?'.exe':'')));
    assert.ok(calls.every(call=>call.tmp.startsWith(checkoutPaths().base+'/est-server/runs/')));
    assert.equal(fs.readFileSync(path.join(destination,'core/est-core'+(target==='win'?'.exe':'')),'utf8'),'source-built-core');
    for (const language of ['german','english']) assert.equal(fs.readFileSync(path.join(destination,`web/audio/P501_C_${language}_f1_FB_48k.wav`),'utf8'),language+'-wav');
    for(const mode of ['local','remote']) {
        const filename=`est-server.config.${mode}.example.json`,packaged=path.join(destination,filename);
        assert.ok(fs.existsSync(packaged),`Missing ${mode}-use example: ${filename}`);
        const config=JSON.parse(fs.readFileSync(packaged,'utf8'));
        assert.equal(config.server.mode,mode);
        assert.deepEqual(config,JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../est-server',filename),'utf8')));
    }
    const again=spawnSync('bash',[script],{env,encoding:'utf8'});assert.notEqual(again.status,0);assert.match(again.stderr,/overwrite|exist/i);
});
