const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkoutPaths}=require('../common/transient-paths.cjs');

test('production transient environments do not inject browser-test settings',()=>{
    assert.equal(checkoutPaths().environment('common',{}).PLAYWRIGHT_BROWSERS_PATH,undefined);
});
test('test cache redirection preserves installed browsers and explicit browser inputs',()=>{
    assert.ok(fs.existsSync(path.join(__dirname,'environment.cjs')),'test-owned environment helper must exist');
    const {testEnvironment}=require('./environment.cjs');
    const original={XDG_CACHE_HOME:'/installed/cache'},env=testEnvironment('est-gui',original);
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH,'/installed/cache/ms-playwright');
    assert.equal(original.PLAYWRIGHT_BROWSERS_PATH,undefined);
    assert.equal(testEnvironment('est-gui',{...env,PLAYWRIGHT_BROWSERS_PATH:'0'}).PLAYWRIGHT_BROWSERS_PATH,'0');
});
