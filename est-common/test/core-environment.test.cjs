const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {coreEnvironment}=require('../core-environment.cjs');

test('bundled runtime overrides host plugin injection without changing the parent environment',t=>{
    const root=fs.mkdtempSync('/tmp/opencode/est-runtime-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const lib=path.join(root,'gst-lib','x86_64-linux-gnu','lib');fs.mkdirSync(path.join(lib,'gstreamer-1.0'),{recursive:true});
    const input={PATH:'/usr/bin',LD_LIBRARY_PATH:'/host',GST_PLUGIN_PATH:'/bad/plugins',GST_PLUGIN_SYSTEM_PATH:'/also/bad'};
    const result=coreEnvironment({executable:path.join(root,'est-core'),env:input,platform:'linux'});
    assert.equal(result.GST_PLUGIN_PATH,path.join(lib,'gstreamer-1.0'));assert.equal(result.GST_PLUGIN_SYSTEM_PATH,path.join(lib,'gstreamer-1.0'));assert.equal(result.LD_LIBRARY_PATH,lib);assert.equal(input.LD_LIBRARY_PATH,'/host');
});
test('source-built external cores retain explicit development runtime settings',()=>{
    const env={LD_LIBRARY_PATH:'/sdk/lib',GST_PLUGIN_SYSTEM_PATH:'/sdk/plugins'};
    assert.deepEqual(coreEnvironment({executable:'/no-bundled/core',env,platform:'linux'}),env);
});
