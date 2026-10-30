const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {stageRuntime}=require('../build_scripts/stage-runtime.cjs');

test('runtime staging refuses incomplete inputs and never overwrites existing resources',async t=>{
    const root=await fs.mkdtemp('/tmp/opencode/est-stage-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const existing=path.join(root,'existing');await fs.mkdir(existing);await fs.writeFile(path.join(existing,'user-file'),'keep');
    await assert.rejects(stageRuntime({target:'linux',destination:existing,sdk:root,executable:'/missing',netsimPlugin:'/missing'}),/exist|overwrite/);
    assert.equal(await fs.readFile(path.join(existing,'user-file'),'utf8'),'keep');
    await assert.rejects(stageRuntime({target:'linux',destination:path.join(root,'new'),sdk:root,executable:'/missing',netsimPlugin:'/missing'}),/missing|ENOENT|input/i);
    await assert.rejects(fs.access(path.join(root,'new')));
});
