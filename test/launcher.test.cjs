const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function launcher() {
    assert.ok(fs.existsSync(path.join(__dirname,'run.cjs')),'central test launcher must exist');
    return require('./run.cjs').runTests;
}
for(const component of ['common','est-core','est-server'])test(`${component} launches absolute suite files with filters and preserves child failure`,async()=>{
    let call;
    const code=await launcher()(component,['--test-name-pattern','a space ü'],{spawnTool:async(executable,args,options)=>{call={executable,args,...options};return 9;}});
    assert.equal(code,9);assert.equal(call.executable,process.execPath);
    assert.equal(call.cwd,path.join(root,component));
    assert.deepEqual(call.args.slice(0,3),['--test','--test-name-pattern','a space ü']);
    const files=call.args.slice(3);assert.ok(files.length>0);
    assert.ok(files.every(file=>path.isAbsolute(file) && path.dirname(file)===path.join(__dirname,component)));
    assert.equal(call.env.TMPDIR,path.join(call.env.EST_TRANSIENT_RUN_DIR,'tmp'));
    assert.ok(call.env.TMPDIR.startsWith(call.env.EST_TRANSIENT_ROOT+path.sep));
});
test('unknown commands and forwarded output/config overrides are rejected',async()=>{
    const run=launcher();
    for(const [command,args] of [['unknown',[]],['common',['--test-reporter-destination','/outside']]]) {
        await assert.rejects(run(command,args,{spawnTool:async()=>assert.fail('must not spawn')}),/unknown|unsupported|managed/i);
    }
});
test('the test CLI is independent of caller cwd',()=>{
    assert.ok(fs.existsSync(path.join(__dirname,'run.cjs')),'central test launcher must exist');
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,[path.join(__dirname,'run.cjs'),'common','--test-name-pattern','shared helpers can be loaded'],{cwd:'/',env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/shared helpers can be loaded/);
});
for(const [command,config,filter] of [['est-gui','vitest.config.mjs',['--run','-t','a space ü']],['e2e','playwright.config.mjs',['--project','chromium']],['audio-tests','playwright.audio.config.mjs',['--list']]]) {
    test(`${command} selects its relocated config, managed artifacts, and test-owned binary`,async()=>{
        let call;
        const code=await launcher()(command,filter,{spawnTool:async(executable,args,options)=>{call={executable,args,...options};return 9;}});
        assert.equal(code,9);assert.equal(call.cwd,path.join(root,'est-gui'));
        assert.equal(call.args[call.args.indexOf('--config')+1],path.join(__dirname,'est-gui',config));
        assert.ok(call.args[0].startsWith(path.join(__dirname,'node_modules')+path.sep));
        assert.deepEqual(call.args.slice(-filter.length),filter);
        assert.ok(call.env.PLAYWRIGHT_HTML_OUTPUT_DIR.startsWith(call.env.EST_TRANSIENT_RUN_DIR+path.sep));
        if(command==='est-gui')assert.ok(call.args.includes('runner'));
    });
}
for(const [command,args] of [['est-gui',['--outputFile','/outside']],['est-gui',['--configLoader','bundle']],['e2e',['--output=/outside']],['audio-tests',['--config','/outside']],['est-gui',['--maxWorkers']]]) {
    test(`${command} rejects unsafe or incomplete arguments ${args[0]}`,async()=>{
        await assert.rejects(launcher()(command,args,{spawnTool:async()=>assert.fail('must not spawn')}),/unsupported|managed/i);
    });
}
