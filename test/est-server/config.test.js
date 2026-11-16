const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {normalizeConfig,publicBootstrap,loadConfig} = require('../../est-server/src/bootstraps/configManager.js');
const {localConfig,remoteConfig} = require('./fixtures/config.js');

test('local-use configuration selects native deployment with one pair and optional setup', () => {
    const config = normalizeConfig(localConfig());
    assert.equal(config.deployment.mode,'local');
    assert.equal(config.deployment.maxActivePairs,1);
    assert.equal(config.audioSetup.enabled,false);
    assert.equal(config.sessions.reconnectGraceMs,60000);
    assert.equal(config.sessions.maxRetries,1);
    assert.equal(config.tests.sct,true);
});
test('remote setup defaults on and cannot be explicitly disabled', () => {
    const raw=remoteConfig(); delete raw.sessions.audioSetup;
    assert.equal(normalizeConfig(raw).audioSetup.enabled,true);
    raw.sessions.audioSetup={enabled:false};
    assert.throws(() => normalizeConfig(raw), /sessions.audioSetup/);
});
test('invalid or overlapping media ranges and unknown settings are rejected', () => {
    for (const remote of [{internalPortRange:[0,100]}, {icePortRange:[9,2]}, {internalPortRange:[40000,50000],icePortRange:[50000,59999]}, {unexpected:true}]) {
        assert.throws(() => normalizeConfig({...remoteConfig(),remote}));
    }
    for (const section of [null, [], 'remote']) assert.throws(() => normalizeConfig({...localConfig(),sessions:section}));
    assert.throws(() => normalizeConfig({...localConfig(),sessions:{maxRetries:-1}}));
});
test('public bootstrap uses an allowlist and exposes no media secrets or completion codes', () => {
    const config=normalizeConfig(remoteConfig());
    const result=publicBootstrap(config);
    assert.equal(result.mode,'remote');
    assert.equal(result.setupRequired,true);
    const text=JSON.stringify(result);
    for (const privateValue of ['private-secret','/private/core','iceServers','completionCodes']) assert.ok(!text.includes(privateValue));
    result.recordings.chunkBytes=1;
    assert.equal(config.recordings.chunkBytes,1048576);
});
test('Prolific requires a study and all configured outcomes before accepting traffic', () => {
    assert.throws(() => normalizeConfig({...remoteConfig(),prolific:{enabled:true}}), /prolific/);
});
test('recording limits scale with condition duration and retain bounded shutdown headroom', () => {
    for (const [seconds, expectedBytes] of [[1,26888192],[600,141896192],[1200,257096192]]) {
        const raw=localConfig();raw.sessions.maxConditionSeconds=seconds;
        const config=normalizeConfig(raw);
        assert.equal(config.recordings.maxConditionSeconds,seconds);
        assert.equal(config.recordings.maxBytesPerParticipant,expectedBytes);
        assert.equal(publicBootstrap(config).recordings.maxBytesPerParticipant,expectedBytes);
    }
    for (const seconds of [0,-1,0.5,11046,2147483647]) {
        const raw=localConfig();raw.sessions.maxConditionSeconds=seconds;
        assert.throws(()=>normalizeConfig(raw),/sessions.maxConditionSeconds/);
    }
    const raw=localConfig();raw.sessions.maxConditionSeconds=11045;
    assert.ok(normalizeConfig(raw).recordings.maxBytesPerParticipant<=2147483647);
});

test('examples share the ordered public schema without changing their study content', () => {
    const local=localConfig(),remote=JSON.parse(fs.readFileSync(path.join(__dirname,'../../est-server/est-server.config.remote.example.json')));
    const keys=['server','remote','prolific','sessions','tests','conditions','pretestForm'];
    for (const raw of [local,remote]) {
        assert.deepEqual(Object.keys(raw),keys);
        assert.deepEqual(Object.keys(raw.server),['ipAddress','port','mode','maxActivePairs']);
        assert.deepEqual(Object.keys(raw.remote),['icePortRange','iceServers','turnUrls','turnSecret']);
        assert.deepEqual(Object.keys(raw.sessions),['pairingTimeoutMs','reconnectGraceMs','maxRetries','maxConditionSeconds','audioSetup']);
        assert.deepEqual(Object.keys(raw.sessions.audioSetup),['enabled','testAsset']);
    }
    assert.deepEqual(Object.keys(local.prolific),Object.keys(remote.prolific));
    assert.deepEqual(Object.keys(local.prolific.completionCodes),Object.keys(remote.prolific.completionCodes));
    assert.equal(local.server.mode,'local');assert.equal(remote.server.mode,'remote');
    assert.equal(local.prolific.enabled,false);assert.equal(remote.prolific.enabled,true);
    assert.equal(local.conditions.random.length,12);assert.equal(local.pretestForm.length,10);
    assert.equal(remote.prolific.studyId,'REPLACE_WITH_STUDY_ID');
    assert.equal(remote.pretestForm[0].validation.min,18);
    // The template intentionally requires a private TURN secret before use.
    remote.remote.turnSecret='test-only-secret';
    assert.equal(normalizeConfig(remote).deployment.mode,'remote');
});

test('server settings and nested session settings reach the existing runtime consumers', () => {
    const raw=localConfig();raw.server.maxActivePairs=3;raw.server.port='4321';
    raw.sessions={pairingTimeoutMs:1234,reconnectGraceMs:2345,maxRetries:2,maxConditionSeconds:1200,audioSetup:{enabled:true,testAsset:'custom.wav'}};
    const config=normalizeConfig(raw);
    assert.equal(config.server.port,4321);assert.equal(config.deployment.maxActivePairs,3);
    assert.equal(config.sessions.pairingTimeoutMs,1234);assert.equal(config.sessions.reconnectGraceMs,2345);assert.equal(config.sessions.maxRetries,2);
    assert.equal(config.recordings.maxConditionSeconds,1200);
    assert.deepEqual(config.audioSetup,{enabled:true,testAsset:'custom.wav'});
    assert.equal(publicBootstrap(config).testAsset,'/audio/custom.wav');
});

test('removed configuration sections report where to move retained settings', () => {
    for (const [section,hint] of [['deployment','server'],['audioSetup','sessions.audioSetup'],['recordings','sessions.maxConditionSeconds']]) {
        assert.throws(()=>normalizeConfig({...localConfig(),[section]:{}}),error=>error.message.includes(section)&&error.message.includes(hint));
    }
});

test('internal transport and safety policies cannot be overridden in either mode', () => {
    for (const fixture of [localConfig,remoteConfig]) {
        for (const [section,keys] of [
            ['server',['allowDevelopmentAdmission','maxWaitingParticipants']],
            ['sessions',['maxWaitingParticipants','chunkBytes','maxBytesPerParticipant','uploadTimeoutMs']],
            ['remote',['coreExecutable','internalPortRange','playbackDrainMs','startupTimeoutMs','stopTimeoutMs','jitterMs','opusBitrate','rtpFrames']]
        ]) for (const key of keys) {
            const raw=fixture();raw[section][key]=1;
            assert.throws(()=>normalizeConfig(raw),error=>error.message.includes(`${section}.${key}`));
        }
        const config=normalizeConfig(fixture());
        assert.equal(config.sessions.maxWaitingParticipants,100);
        assert.equal(config.recordings.chunkBytes,1048576);assert.equal(config.recordings.uploadTimeoutMs,600000);
        assert.deepEqual(config.remote.internalPortRange,[40000,49999]);
        assert.equal(config.remote.playbackDrainMs,250);assert.equal(config.remote.startupTimeoutMs,30000);assert.equal(config.remote.stopTimeoutMs,7000);
        assert.equal(config.remote.jitterMs,20);assert.equal(config.remote.opusBitrate,128000);assert.equal(config.remote.rtpFrames,128);
    }
});

test('retained fields reject malformed values and private-port collisions', () => {
    for (const change of [
        raw=>{raw.server.mode='other';},raw=>{raw.server.mode=null;},raw=>{raw.server.maxActivePairs=0;},
        raw=>{raw.remote.icePortRange=[49000,50000];},raw=>{raw.remote.icePortRange=[60000,50000];},
        raw=>{raw.sessions.audioSetup={enabled:true,testAsset:'../escape.wav'};},
        raw=>{raw.sessions.audioSetup={enabled:true,testAsset:'ok.wav',unknown:true};},
        raw=>{raw.remote.iceServers=[{urls:'stun:example.org',credential:'hidden-option'}];}
    ]) {const raw=localConfig();change(raw);assert.throws(()=>normalizeConfig(raw));}
    const raw=localConfig();raw.remote.iceServers=[{urls:['stun:example.org:3478']}];
    assert.deepEqual(normalizeConfig(raw).remote.iceServers,[{urls:['stun:example.org:3478']}]);
});

test('runtime configuration objects do not share mutable policy or supplied objects', () => {
    const raw=remoteConfig(),first=normalizeConfig(raw);first.remote.internalPortRange[0]=45000;
    first.audioSetup.enabled=false;first.recordings.chunkBytes=1;
    assert.equal(normalizeConfig(raw).remote.internalPortRange[0],40000);
    assert.equal(raw.sessions.audioSetup.enabled,true);
    assert.equal(normalizeConfig(raw).recordings.chunkBytes,1048576);
});

test('core resource selection is automatic for source builds and packaged Linux/Windows', () => {
    const {resources,coreExecutable}=require('../../est-server/src/bootstraps/resources.js');
    assert.equal(coreExecutable({packaged:true,platform:'linux',executable:'/opt/study/est-server'}),'/opt/study/core/est-core');
    assert.equal(coreExecutable({packaged:true,platform:'win32',executable:'C:\\study\\est-server.exe'}),'C:\\study\\core\\est-core.exe');
    assert.equal(coreExecutable({packaged:false,platform:'linux'}),checkoutPaths().path('est-core','build','linux','est-core'));
    assert.equal(coreExecutable({packaged:false,platform:'win32'}),checkoutPaths().path('est-core','build','win','est-core.exe'));
    const config=normalizeConfig(remoteConfig()),result=resources(config);
    assert.equal(result.config.remote.coreExecutable,coreExecutable());
});
for(const mode of ['local','remote'])test(`${mode}-use server loads est-server.config.json from the account home`,t=>{
    const home=checkoutPaths().temporaryDirectory('est-server','config home-');
    t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
    const directory=path.join(home,'effectstreamer');fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'est-server.config.json'),JSON.stringify(mode==='local'?localConfig():remoteConfig()));
    const env={...process.env,HOME:home,USERPROFILE:home};delete env.EST_CONFIG_PATH;
    const module=path.resolve(__dirname,'../../est-server/src/bootstraps/configManager.js');
    const result=spawnSync(process.execPath,['-e',`console.log(require(${JSON.stringify(module)}).loadConfig().deployment.mode)`],{cwd:home,env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),mode);
});
test('EST_CONFIG_PATH overrides the home path without changing working directory', (t) => {
    const dir=checkoutPaths().temporaryDirectory('est-server','est-config-');
    t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
    const p=path.join(dir,'config.json'); fs.writeFileSync(p,JSON.stringify(localConfig()));
    const old=process.env.EST_CONFIG_PATH;
    t.after(() => { if(old === undefined) delete process.env.EST_CONFIG_PATH; else process.env.EST_CONFIG_PATH=old; });
    process.env.EST_CONFIG_PATH=p;
    assert.equal(loadConfig().deployment.mode,'local');
});
