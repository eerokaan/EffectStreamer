const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startCore}=require('../../common/core-process.cjs');

function fixture(mode='normal') {
    // A separate real child exercises OS pipes/process exits, not a mocked spawn API.
    return {executable:process.execPath,args:[require.resolve('./fixtures/core-child.cjs'),mode],timeoutMs:1000};
}
test('core host parses split output, separates logs and correlates out-of-order replies',async(t)=>{
    const core=await startCore(fixture()); t.after(()=>core.stop({timeoutMs:1000}));
    const results=await Promise.all([core.request('first',{number:1}),core.request('second',{number:2})]);
    assert.deepEqual(results,[{number:1},{number:2}]);
    await assert.rejects(core.request('fail',{}),/rejected/);
    await core.stop({timeoutMs:1000}); await core.stop({timeoutMs:1000});
    assert.equal(core.child.exitCode,0);
});
test('core host rejects a child which dies before readiness',async()=>{
    await assert.rejects(startCore(fixture('die')),/before readiness/);
});
test('core host bounds oversized and malformed output and terminates the child',async()=>{
    for(const mode of ['malformed','oversized']) await assert.rejects(startCore(fixture(mode)),/NDJSON|limit|JSON/);
});
test('core host kills a child which never reaches readiness',async()=>{
    await assert.rejects(startCore({...fixture('hang'),timeoutMs:50}),/Timed out/);
});
test('unexpected exit rejects pending requests and cannot be mistaken for a graceful stop',async()=>{
    const core=await startCore(fixture());
    await assert.rejects(core.request('crash',{}),/exited/);
    await assert.rejects(core.stop(),/unsuccessfully/);
});
