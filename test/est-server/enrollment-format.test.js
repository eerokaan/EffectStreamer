const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {EnrollmentStore}=require('../../est-server/src/services/EnrollmentStore.js');
const {Prolific}=require('../../est-server/src/services/Prolific.js');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {remoteConfig}=require('./fixtures/config.js');
const sessionLanguage='de';

function fixture(t) {
    const root=checkoutPaths().temporaryDirectory('est-server','enrollment-format-');
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=new EnrollmentStore(root,{sessionLanguage,now:()=>1000});
    const credentials=store.admit({identity:'person-a'});
    return {root,file:path.join(root,'enrollments.json'),participant:store.get(credentials.participantId),credentials};
}

for(const value of [undefined,null,'1000',-1,1.5,Infinity]) {
    test(`invalid stored admission timestamp ${String(value)} is rejected without modifying bytes`,t=>{
        const f=fixture(t),person={...f.participant,admissionLastActiveAt:value};
        const bytes=JSON.stringify([person],null,2).replace('"admissionLastActiveAt": null',value===Infinity?'"admissionLastActiveAt": 1e999':'"admissionLastActiveAt": null');
        fs.writeFileSync(f.file,bytes);
        assert.throws(()=>new EnrollmentStore(f.root,{sessionLanguage,now:()=>9000}),/admissionLastActiveAt/);
        assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
    });
}
for(const state of [{sessionId:'session-1'},{outcome:'completed'}]) test('paired and terminal enrollments also require a current timestamp: '+JSON.stringify(state),t=>{
    const f=fixture(t),person={...f.participant,...state};delete person.admissionLastActiveAt;
    const bytes=JSON.stringify([person]);fs.writeFileSync(f.file,bytes);
    assert.throws(()=>new EnrollmentStore(f.root,{sessionLanguage}),/admissionLastActiveAt/);
    assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
});
for(const timestamp of [0,1000]) test(`current timestamp ${timestamp} reloads without saving or renewing activity`,t=>{
    const f=fixture(t),bytes=JSON.stringify([{...f.participant,admissionLastActiveAt:timestamp}]);fs.writeFileSync(f.file,bytes);
    t.mock.method(EnrollmentStore.prototype,'save',()=>{throw new Error('load must not save');});
    const loaded=new EnrollmentStore(f.root,{sessionLanguage,now:()=>9000});
    assert.equal(loaded.authenticate(f.credentials.reconnectToken).admissionLastActiveAt,timestamp);
    assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
});
test('new admissions persist their activity timestamp and reload does not extend expiry',t=>{
    const f=fixture(t),loaded=new EnrollmentStore(f.root,{sessionLanguage,now:()=>2001});
    assert.equal(loaded.get(f.participant.participantId).admissionLastActiveAt,1000);
    const raw=remoteConfig();raw.sessions.operatingLimits.pairingTimeoutSeconds=1;
    const prolific=new Prolific({config:normalizeConfig(raw),enrollments:loaded,getSession:()=>null,now:()=>2001});
    assert.equal(prolific.expireWaiting(),true);
    assert.equal(new EnrollmentStore(f.root,{sessionLanguage}).get(f.participant.participantId).outcome,'waitingTimeout');
});
