const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {coreEnvironment}=require('../core-environment.cjs');
const {checkoutPaths}=require('../transient-paths.cjs');
const {spawnSync}=require('node:child_process');

test('bundled runtime overrides host plugin injection without changing the parent environment',t=>{
    const root=checkoutPaths().temporaryDirectory('common','est-runtime-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const lib=path.join(root,'gst-lib','x86_64-linux-gnu','lib');fs.mkdirSync(path.join(lib,'gstreamer-1.0'),{recursive:true});
    const input={PATH:'/usr/bin',LD_LIBRARY_PATH:'/host',GST_PLUGIN_PATH:'/bad/plugins',GST_PLUGIN_SYSTEM_PATH:'/also/bad'};
    const result=coreEnvironment({executable:path.join(root,'est-core'),env:input,platform:'linux'});
    assert.equal(result.GST_PLUGIN_PATH,path.join(lib,'gstreamer-1.0'));assert.equal(result.GST_PLUGIN_SYSTEM_PATH,path.join(lib,'gstreamer-1.0'));assert.equal(result.LD_LIBRARY_PATH,lib);assert.equal(input.LD_LIBRARY_PATH,'/host');
});
test('a versioned registry override cannot make hosted GStreamer write outside its managed cache',t=>{
    const root=checkoutPaths().temporaryDirectory('common','registry-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const inherited=path.join(root,'inherited-registry.bin'),env=coreEnvironment({executable:path.join(root,'core'),env:{...process.env,GST_REGISTRY_1_0:inherited}});
    assert.equal(env.GST_REGISTRY_1_0,env.GST_REGISTRY);
    const probe=spawnSync('gst-inspect-1.0',['coreelements'],{env,encoding:'utf8',timeout:15000});
    if(probe.error?.code==='ENOENT'){t.skip('host GStreamer inspection tool unavailable');return;}
    assert.equal(probe.status,0,probe.stderr);assert.ok(fs.existsSync(env.GST_REGISTRY));assert.equal(fs.existsSync(inherited),false);
});
test('source-built external cores retain explicit development runtime settings',()=>{
    const env={LD_LIBRARY_PATH:'/sdk/lib',GST_PLUGIN_SYSTEM_PATH:'/sdk/plugins'};
    const result=coreEnvironment({executable:'/no-bundled/core',env,platform:'linux'});
    assert.equal(result.LD_LIBRARY_PATH,env.LD_LIBRARY_PATH);assert.equal(result.GST_PLUGIN_SYSTEM_PATH,env.GST_PLUGIN_SYSTEM_PATH);
    assert.match(result.GST_REGISTRY,/^\/tmp\/effectstreamer\/uid-\d+\/[a-f0-9]{16}\/est-core\/cache\/gstreamer\/registry-linux.bin$/);
    assert.match(result.TMPDIR,/^\/tmp\/effectstreamer\//);assert.deepEqual(env,{LD_LIBRARY_PATH:'/sdk/lib',GST_PLUGIN_SYSTEM_PATH:'/sdk/plugins'});
});
