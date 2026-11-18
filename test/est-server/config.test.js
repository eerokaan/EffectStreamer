const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {normalizeConfig,publicBootstrap} = require('../../est-server/src/bootstraps/configManager.js');
const {localConfig,remoteConfig} = require('./fixtures/config.js');

function groupedConfig(mode = 'local') {
    const raw = mode === 'local' ? localConfig() : remoteConfig();
    return {...raw, sessions: {
        general: {language: 'en', audioSetup: mode === 'remote'},
        tests: {'short-conversation-test': false, 'listening-speaking-test': true},
        operatingLimits: {pairingTimeoutSeconds: 300, reconnectGraceSeconds: 60, maxConditionSeconds: 600, maxRetries: 1}
    }};
}

test('consumes the grouped config with whole-second timing and no sample path in bootstrap', () => {
    for (const mode of ['local','remote']) {
        const config = normalizeConfig(groupedConfig(mode));
        assert.equal(config.sessions.pairingTimeoutMs, 300000);
        assert.equal(config.sessions.reconnectGraceMs, 60000);
        assert.deepEqual(config.tests, {sct:false,lst:true});
        const bootstrap = publicBootstrap(config);
        assert.equal(bootstrap.setupRequired, mode === 'remote');
        assert.equal(bootstrap.sessionLanguage, 'en');
        assert.ok(!Object.hasOwn(bootstrap, 'testAsset'));
    }
});

test('rejects old keys, override attempts and invalid operating limits', () => {
    for (const [edit, error] of [
        [raw => {raw.tests = {};}, /config\.tests is unknown/],
        [raw => {raw.sessions.language = 'de';}, /sessions\.language is unknown/],
        [raw => {raw.sessions.general.testAsset = 'override.wav';}, /sessions\.general\.testAsset is unknown/],
        [raw => {raw.sessions.general.audioSetup = {enabled:true};}, /sessions\.general\.audioSetup.*boolean/],
        [raw => {raw.sessions.general.audioSetup = 'false';}, /sessions\.general\.audioSetup.*boolean/],
        [raw => {raw.sessions.operatingLimits.pairingTimeoutMs = 1000;}, /sessions\.operatingLimits\.pairingTimeoutMs is unknown/],
        [raw => {raw.sessions.operatingLimits.pairingTimeoutSeconds = 0.5;}, /sessions\.operatingLimits\.pairingTimeoutSeconds/],
        [raw => {raw.sessions.operatingLimits.reconnectGraceSeconds = 2147484;}, /sessions\.operatingLimits\.reconnectGraceSeconds/]
    ]) {
        const raw = groupedConfig(); edit(raw); assert.throws(() => normalizeConfig(raw), error);
    }
});

test('local-use configuration selects native deployment with one pair and optional setup', () => {
    const config = normalizeConfig(localConfig());
    assert.equal(config.deployment.mode,'local');
    assert.equal(config.deployment.maxActivePairs,1);
    assert.equal(config.audioSetup,false);
    assert.equal(config.sessions.reconnectGraceMs,60000);
    assert.equal(config.sessions.maxRetries,1);
    assert.equal(config.tests.sct,true);
});
test('remote setup defaults on and cannot be explicitly disabled', () => {
    const raw=remoteConfig(); delete raw.sessions.general.audioSetup;
    assert.equal(normalizeConfig(raw).audioSetup,true);
    raw.sessions.general.audioSetup=false;
    assert.throws(() => normalizeConfig(raw), /sessions\.general\.audioSetup/);
});
test('both deployment modes require exactly en or de at sessions.general.language', () => {
    for (const fixture of [localConfig, remoteConfig]) {
        for (const language of [undefined,null,'','EN','de-DE','en ','fr',42,['en']]) {
            const raw=fixture();raw.sessions.general.language=language;
            assert.throws(() => normalizeConfig(raw), /\[Config\] sessions\.general\.language/);
        }
        const withoutSessions=fixture();delete withoutSessions.sessions;
        assert.throws(() => normalizeConfig(withoutSessions), /\[Config\] sessions\.general\.language/);
    }
});
test('omitted operating limits preserve the 300 s pairing and 60 s reconnect defaults', () => {
    const raw=localConfig();delete raw.sessions.operatingLimits;delete raw.sessions.general.audioSetup;
    const config=normalizeConfig(raw);
    assert.equal(config.audioSetup,false);
    assert.equal(config.sessions.pairingTimeoutMs,300000);
    assert.equal(config.sessions.reconnectGraceMs,60000);
    assert.equal(config.sessions.maxRetries,1);
    assert.equal(config.recordings.maxConditionSeconds,600);
});
test('invalid or overlapping media ranges and unknown settings are rejected', () => {
    for (const remote of [{internalPortRange:[0,100]}, {icePortRange:[9,2]}, {internalPortRange:[40000,50000],icePortRange:[50000,59999]}, {unexpected:true}]) {
        assert.throws(() => normalizeConfig({...remoteConfig(),remote}));
    }
    for (const section of [null, [], 'remote']) assert.throws(() => normalizeConfig({...localConfig(),sessions:section}));
    const raw=localConfig();raw.sessions.operatingLimits.maxRetries=-1;
    assert.throws(() => normalizeConfig(raw), /sessions\.operatingLimits\.maxRetries/);
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
        const raw=localConfig();raw.sessions.operatingLimits.maxConditionSeconds=seconds;
        const config=normalizeConfig(raw);
        assert.equal(config.recordings.maxConditionSeconds,seconds);
        assert.equal(config.recordings.maxBytesPerParticipant,expectedBytes);
        assert.equal(publicBootstrap(config).recordings.maxBytesPerParticipant,expectedBytes);
    }
    for (const seconds of [0,-1,0.5,11046,2147483647]) {
        const raw=localConfig();raw.sessions.operatingLimits.maxConditionSeconds=seconds;
        assert.throws(()=>normalizeConfig(raw),/sessions\.operatingLimits\.maxConditionSeconds/);
    }
    const raw=localConfig();raw.sessions.operatingLimits.maxConditionSeconds=11045;
    assert.ok(normalizeConfig(raw).recordings.maxBytesPerParticipant<=2147483647);
});

test('examples share the ordered public schema without changing their study content', () => {
    const local=localConfig(),remote=JSON.parse(fs.readFileSync(path.join(__dirname,'../../est-server/est-server.config.remote.example.json')));
    const keys=['server','remote','prolific','sessions','conditions','pretestForm'];
    for (const raw of [local,remote]) {
        assert.deepEqual(Object.keys(raw),keys);
        assert.deepEqual(Object.keys(raw.server),['mode','ipAddress','port','maxActivePairs']);
        assert.deepEqual(Object.keys(raw.remote),['icePortRange','iceServers','turnUrls','turnSecret']);
        assert.deepEqual(Object.keys(raw.sessions),['general','tests','operatingLimits']);
        assert.deepEqual(Object.keys(raw.sessions.general),['language','audioSetup']);
        assert.equal(raw.sessions.general.language,'de');
        assert.deepEqual(Object.keys(raw.sessions.operatingLimits),['pairingTimeoutSeconds','reconnectGraceSeconds','maxConditionSeconds','maxRetries']);
        assert.deepEqual(raw.sessions.operatingLimits,{pairingTimeoutSeconds:300,reconnectGraceSeconds:60,maxConditionSeconds:600,maxRetries:1});
    }
    assert.deepEqual(Object.keys(local.prolific),Object.keys(remote.prolific));
    assert.deepEqual(Object.keys(local.prolific.completionCodes),Object.keys(remote.prolific.completionCodes));
    assert.equal(local.server.mode,'local');assert.equal(remote.server.mode,'remote');
    assert.equal(local.sessions.general.audioSetup,false);assert.equal(remote.sessions.general.audioSetup,true);
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
    raw.sessions.general.audioSetup=true;
    raw.sessions.operatingLimits={pairingTimeoutSeconds:12,reconnectGraceSeconds:23,maxRetries:2,maxConditionSeconds:1200};
    const config=normalizeConfig(raw);
    assert.equal(config.server.port,4321);assert.equal(config.deployment.maxActivePairs,3);
    assert.equal(config.sessions.pairingTimeoutMs,12000);assert.equal(config.sessions.reconnectGraceMs,23000);assert.equal(config.sessions.maxRetries,2);
    assert.equal(config.recordings.maxConditionSeconds,1200);
    assert.equal(config.audioSetup,true);
    assert.equal(publicBootstrap(config).setupRequired,true);
});

test('unsupported configuration sections fail normal known-key validation', () => {
    for (const section of ['deployment','audioSetup','recordings','language','sessions-language','sessionLanguage']) {
        assert.throws(()=>normalizeConfig({...localConfig(),[section]:{}}),{message:`[Config] config.${section} is unknown`});
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
        raw=>{raw.sessions.general=null;},
        raw=>{raw.sessions.tests['listening-speaking-test']='true';},
        raw=>{raw.remote.iceServers=[{urls:'stun:example.org',credential:'hidden-option'}];}
    ]) {const raw=localConfig();change(raw);assert.throws(()=>normalizeConfig(raw));}
    const raw=localConfig();raw.remote.iceServers=[{urls:['stun:example.org:3478']}];
    assert.deepEqual(normalizeConfig(raw).remote.iceServers,[{urls:['stun:example.org:3478']}]);
});

test('runtime configuration objects do not share mutable policy or supplied objects', () => {
    const raw=remoteConfig(),first=normalizeConfig(raw);first.remote.internalPortRange[0]=45000;
    first.audioSetup=false;first.recordings.chunkBytes=1;
    assert.equal(normalizeConfig(raw).remote.internalPortRange[0],40000);
    assert.equal(raw.sessions.general.audioSetup,true);
    assert.equal(normalizeConfig(raw).recordings.chunkBytes,1048576);
});

test('core resource selection is automatic for source builds and packaged Linux/Windows', () => {
    const {coreExecutable}=require('../../est-server/src/bootstraps/resources.js');
    assert.equal(coreExecutable({packaged:true,platform:'linux',executable:'/opt/study/est-server'}),'/opt/study/core/est-core');
    assert.equal(coreExecutable({packaged:true,platform:'win32',executable:'C:\\study\\est-server.exe'}),'C:\\study\\core\\est-core.exe');
    assert.equal(coreExecutable({packaged:false,platform:'linux'}),checkoutPaths().path('est-core','build','linux','est-core'));
    assert.equal(coreExecutable({packaged:false,platform:'win32'}),checkoutPaths().path('est-core','build','win','est-core.exe'));
    assert.equal(normalizeConfig(remoteConfig()).remote.coreExecutable,coreExecutable());
});
for(const mode of ['local','remote'])test(`${mode}-use server loads est-server.config.json from the account home`,t=>{
    const home=checkoutPaths().temporaryDirectory('est-server','config home-');
    t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
    const directory=path.join(home,'effectstreamer');fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'est-server.config.json'),JSON.stringify(mode==='local'?localConfig():remoteConfig()));
    const env={...process.env,HOME:home,USERPROFILE:home};
    const module=path.resolve(__dirname,'../../est-server/src/bootstraps/configManager.js');
    const result=spawnSync(process.execPath,['-e',`console.log(require(${JSON.stringify(module)}).loadConfig().deployment.mode)`],{cwd:home,env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),mode);
});
test('server startup stores enrollments under the account home', t=>{
    const home=checkoutPaths().temporaryDirectory('est-server','results home-');
    t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
    const directory=path.join(home,'effectstreamer');fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'est-server.config.json'),JSON.stringify(localConfig()));
    const result=spawnSync(process.execPath,['-e',`
        const {loadConfig}=require('./src/bootstraps/configManager.js');
        const {createCoordinator}=require('./src/server.js');
        (async()=>{
            const app=createCoordinator({config:loadConfig()});
            try {
                await app.ready;
                app.enrollments.admit({identity:'client-a'});
            } finally {
                await app.close();
            }
        })().catch(error=>{console.error(error);process.exitCode=1;});
    `],{cwd:path.resolve(__dirname,'../../est-server'),env:{...process.env,HOME:home,USERPROFILE:home},encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr || result.error?.message);
    const records=JSON.parse(fs.readFileSync(path.join(directory,'sessions','enrollments.json'),'utf8'));
    assert.deepEqual(records.map(record=>record.identity),['client-a']);
});
