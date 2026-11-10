const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

for(const [component,old] of [['common','test'],['est-core','tests'],['est-server','test'],['est-gui','test']]) {
    test(`${component} keeps its automated suite outside the application component`,()=>{
        assert.ok(fs.statSync(path.join(__dirname,component)).isDirectory());
        assert.equal(fs.existsSync(path.join(root,component,old)),false);
    });
}
test('application components contain no test-only entry points or example host',()=>{
    for(const component of ['common','est-server','est-gui']) {
        const pkg=require(path.join(root,component,'package.json'));
        assert.deepEqual(Object.keys(pkg.scripts || {}).filter(name=>name==='test' || name.startsWith('test:')),[]);
        for(const name of ['vitest','@playwright/test'])assert.equal(pkg.devDependencies?.[name],undefined);
    }
    assert.equal(require('../est-server/package.json').devDependencies['socket.io-client'],undefined);
    for(const filename of ['vitest.config.mjs','playwright.config.mjs','playwright.audio.config.mjs']) {
        assert.equal(fs.existsSync(path.join(root,'est-gui',filename)),false);
        assert.ok(fs.existsSync(path.join(__dirname,'est-gui',filename)));
    }
    assert.equal(fs.existsSync(path.join(root,'est-core/examples')),false);
});
test('the private test package owns test dependencies and all suite entry points',()=>{
    assert.ok(fs.existsSync(path.join(__dirname,'package.json')),'dedicated test package must exist');
    const pkg=require('./package.json');
    assert.equal(pkg.private,true);
    for(const name of ['vitest','@playwright/test','socket.io-client','@electron/asar'])assert.ok(pkg.devDependencies[name],name);
    for(const name of ['test','test:layout','test:common','test:est-core','test:est-server','test:est-gui','test:e2e','test:audio-browser','build:core'])assert.ok(pkg.scripts[name],name);
});
