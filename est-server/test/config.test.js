const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {normalizeConfig,publicBootstrap,loadConfig} = require('../src/bootstraps/configManager.js');
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
    const raw=remoteConfig(); delete raw.audioSetup;
    assert.equal(normalizeConfig(raw).audioSetup.enabled,true);
    assert.throws(() => normalizeConfig({...remoteConfig(),audioSetup:{enabled:false}}), /audioSetup/);
});
test('invalid or overlapping media ranges and unknown settings are rejected', () => {
    for (const remote of [{internalPortRange:[0,100]}, {icePortRange:[9,2]}, {internalPortRange:[40000,50000],icePortRange:[50000,59999]}, {unexpected:true}]) {
        assert.throws(() => normalizeConfig({...remoteConfig(),remote}));
    }
    for (const section of [null, [], 'remote']) assert.throws(() => normalizeConfig({...localConfig(),deployment:section}));
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
test('recording limits cover both WAVs and reject invalid chunk sizes', () => {
    assert.throws(() => normalizeConfig({...localConfig(),recordings:{chunkBytes:0}}));
    assert.throws(() => normalizeConfig({...localConfig(),recordings:{maxConditionSeconds:600,maxBytesPerParticipant:1000000}}));
});
for(const mode of ['local','remote'])test(`${mode}-use server loads est-server.config.json from the account home`,t=>{
    const home=checkoutPaths().temporaryDirectory('est-server','config home-');
    t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
    const directory=path.join(home,'effectstreamer');fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'est-server.config.json'),JSON.stringify(mode==='local'?localConfig():remoteConfig()));
    const env={...process.env,HOME:home,USERPROFILE:home};delete env.EST_CONFIG_PATH;
    const module=path.resolve(__dirname,'../src/bootstraps/configManager.js');
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
