const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {stageRuntime}=require('../build_scripts/stage-runtime.cjs');
const {checkoutPaths}=require('../../est-common/transient-paths.cjs');
const {runtimeFixture}=require('./fixtures/runtime-sdk.cjs');

test('runtime staging refuses incomplete inputs and never overwrites existing resources',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-core','est-stage-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const existing=path.join(root,'existing');await fs.mkdir(existing);await fs.writeFile(path.join(existing,'user-file'),'keep');
    await assert.rejects(stageRuntime({target:'linux',destination:existing,sdk:root,executable:'/missing',netsimPlugin:'/missing'}),/exist|overwrite/);
    assert.equal(await fs.readFile(path.join(existing,'user-file'),'utf8'),'keep');
    await assert.rejects(stageRuntime({target:'linux',destination:path.join(root,'new'),sdk:root,executable:'/missing',netsimPlugin:'/missing'}),/missing|ENOENT|input/i);
    await assert.rejects(fs.access(path.join(root,'new')));
});
for(const target of ['linux','win'])test(`${target} runtime resources are copied directly without publication rename`,async t=>{
    const root=checkoutPaths().temporaryDirectory('est-core','stage-direct-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const inputs=runtimeFixture(root,target),destination=path.join(root,'resources');
    t.mock.method(fs,'rename',()=>{throw new Error('publication rename forbidden');});
    const copy=fs.copyFile.bind(fs),writes=[];
    t.mock.method(fs,'copyFile',async(source,dest,...args)=>{writes.push(dest);return copy(source,dest,...args);});
    await stageRuntime({...inputs,destination});
    assert.ok(writes.length>10);assert.ok(writes.every(file=>file.startsWith(destination+path.sep)));
    assert.equal(await fs.readFile(path.join(destination,'est-core'+(target==='win'?'.exe':'')),'utf8'),'source-built-core');
    assert.ok((await fs.readdir(root)).every(name=>!name.includes('.tmp-')));
});
test('failed direct runtime copy leaves an incomplete destination and never clobbers it on retry',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-core','stage-failure-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const inputs=runtimeFixture(root),destination=path.join(root,'resources'),copy=fs.copyFile.bind(fs);
    const mocked=t.mock.method(fs,'copyFile',async(source,dest,...args)=>{if(dest.endsWith('libgstopus.so'))throw new Error('disk failure');return copy(source,dest,...args);});
    await assert.rejects(stageRuntime({...inputs,destination}),/disk failure/);assert.ok((await fs.stat(destination)).isDirectory());
    mocked.mock.restore();await assert.rejects(stageRuntime({...inputs,destination}),/overwrite|exist/i);
});
