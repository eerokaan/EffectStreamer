const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {SessionFiles}=require('../../est-server/src/services/SessionFiles.js');

function fixture(t) {
    const root=checkoutPaths().temporaryDirectory('est-server','session-paths-');
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    return {root,config:{conditions:{baseline:[{}],random:[]}}};
}
for(const sessionId of [undefined,'','../outside'])test(`invalid current session ID ${String(sessionId)} fails before creating directories`,t=>{
    const f=fixture(t),root=path.join(f.root,'results');
    const files=new SessionFiles({state:{sessionId},config:f.config,root});
    assert.throws(()=>files.createFolderStructure(),/sessionId/);
    assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('current session creation neither scans nor changes existing numbered directories',t=>{
    const f=fixture(t),old=path.join(f.root,'session_0007');fs.mkdirSync(old);fs.writeFileSync(path.join(old,'recording.wav'),'retained bytes');
    const state={sessionId:'session-current'},files=new SessionFiles({state,config:f.config,root:f.root});
    t.mock.method(fs,'readdirSync',()=>{throw new Error('session creation must not scan old directories');});
    files.createFolderStructure();
    assert.equal(state.sessionDir,path.join(f.root,'session-current'));
    assert.ok(fs.statSync(path.join(state.sessionDir,'condition_0001')).isDirectory());
    assert.equal(fs.readFileSync(path.join(old,'recording.wav'),'utf8'),'retained bytes');
});
