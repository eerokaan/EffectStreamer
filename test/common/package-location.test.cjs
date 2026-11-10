const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),common=path.join(root,'common');

test('shared helpers can be loaded from the common directory',()=>{
    assert.doesNotThrow(()=>require.resolve(common));
    assert.equal(require(common),require('../../common/protocol.cjs'));
});

for(const component of ['est-gui','est-server'])test(`${component} resolves its shared dependency and lockfile to common`,()=>{
    const project=path.join(root,component),manifest=require(path.join(project,'package.json'));
    const dependency=manifest.dependencies['@effectstreamer/common'];
    assert.equal(dependency,'file:../common');
    assert.equal(require(path.resolve(project,dependency.slice('file:'.length))),require(common));
    const lock=require(path.join(project,'package-lock.json'));
    assert.equal(lock.packages[''].dependencies['@effectstreamer/common'],dependency);
    const link=lock.packages['node_modules/@effectstreamer/common'];
    assert.equal(link.link,true);
    assert.equal(path.resolve(project,link.resolved),common);
    assert.ok(lock.packages['../common']);
});
