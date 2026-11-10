const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {SessionStore}=require('../src/services/SessionStore.js');
const {EnrollmentStore}=require('../src/services/EnrollmentStore.js');
const {SessionFiles}=require('../src/services/SessionFiles.js');
test('server metadata saves directly and serialized sessions retain the last successful update',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','direct-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    t.mock.method(fs.promises,'rename',()=>{throw new Error('rename forbidden');});
    t.mock.method(fs,'renameSync',()=>{throw new Error('rename forbidden');});
    const enrollments=new EnrollmentStore(root);enrollments.admit({identity:'test-person'});
    const store=new SessionStore(root);
    await Promise.all([store.save({sessionId:'session-1',revision:1}),store.save({sessionId:'session-1',revision:2})]);
    assert.equal((await store.loadAll())[0].revision,2);
    const files=new SessionFiles({state:{sessionDir:root},config:{}});
    files.saveFile('sessionDir','answers.json','{"answer":1}');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'answers.json'))).answer,1);
    assert.equal(fs.statSync(path.join(root,'enrollments.json')).mode & 0o777,0o600);
    assert.ok(fs.readdirSync(root).every(name=>!name.includes('.tmp')));
});
test('corrupt enrollment and session JSON remains an error instead of an empty reset',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','corrupt-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.writeFileSync(path.join(root,'enrollments.json'),'{');assert.throws(()=>new EnrollmentStore(root));
    fs.mkdirSync(path.join(root,'session-1'));fs.writeFileSync(path.join(root,'session-1/session.json'),'{');
    await assert.rejects(new SessionStore(root).loadAll());
});
test('two coordinators cannot concurrently write the same persistent results root',async t=>{
    const {createCoordinator}=require('../src/server.js'),{normalizeConfig}=require('../src/bootstraps/configManager.js'),{localConfig}=require('./fixtures/config.js');
    const root=checkoutPaths().temporaryDirectory('est-server','exclusive-');
    const first=createCoordinator({config:normalizeConfig(localConfig()),root});
    t.after(async()=>{await first.close();fs.rmSync(root,{recursive:true,force:true});});
    let conflicting;
    try {assert.throws(()=>{conflicting=createCoordinator({config:normalizeConfig(localConfig()),root});},/lock|instance/i);}
    finally {if(conflicting)await conflicting.close();await first.close();}
    const next=createCoordinator({config:normalizeConfig(localConfig()),root});await next.close();
});
