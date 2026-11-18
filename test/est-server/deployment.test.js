const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {io:connect}=require('socket.io-client');
const {createCoordinator}=require('../../est-server/src/server.js');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {remoteConfig}=require('./fixtures/config.js');
const {spawnSync}=require('node:child_process');
const {checkoutPaths}=require('../../common/transient-paths.cjs');

for (const [language, filename] of [['de','P501_C_german_f1_FB_48k.wav'],['en','P501_C_english_f1_FB_48k.wav']]) test(`same-origin hosting serves the ${language} setup WAV and keeps private routes out of SPA fallback`,async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-deploy-');
    const webRoot=path.join(root,'.private-build','web');await fs.mkdir(webRoot,{recursive:true});
    await fs.writeFile(path.join(webRoot,'index.html'),'<!doctype html><title>Study</title>');
    await fs.mkdir(path.join(webRoot,'audio'));
    await fs.copyFile(path.resolve(__dirname,'../../est-gui/public/audio',filename),path.join(webRoot,'audio',filename));
    const raw=remoteConfig();raw.sessions.general.language=language;
    const app=createCoordinator({config:normalizeConfig(raw),root:path.join(root,'results'),webRoot});
    t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
    await app.ready;app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port;
    const main=await fetch(url+'/');assert.equal(main.status,200);assert.match(main.headers.get('content-type'),/text\/html/);assert.match(await main.text(),/<title>Study/);
    const config=await fetch(url+'/api/config');assert.match(config.headers.get('cache-control'),/no-store/);assert.doesNotMatch(await config.clone().text(),/private-secret|completionCodes|coreExecutable/);
    const bootstrap=await config.json();assert.equal(bootstrap.sessionLanguage,language);assert.ok(!Object.hasOwn(bootstrap,'testAsset'));
    const sample=await fetch(url+'/audio/'+filename);assert.equal(sample.status,200);assert.match(sample.headers.get('content-type'),/audio\/(wav|wave|x-wav)/);assert.equal(Buffer.from(await sample.arrayBuffer()).toString('ascii',0,4),'RIFF');
    for(const route of ['/api/unknown','/assets/missing.js','/audio/missing.wav','/session.json','/src/server.js']) assert.equal((await fetch(url+route)).status,404,route);
    const person=app.enrollments.admit({identity:'websocket-smoke'}),socket=connect(url,{auth:{reconnectToken:person.reconnectToken},transports:['websocket'],reconnection:false});t.after(()=>socket.disconnect());
    await once(socket,'connect');assert.equal(socket.io.engine.transport.name,'websocket');
});

test('an explicitly configured missing web build fails readiness instead of accepting participants',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-no-web-');
    const app=createCoordinator({config:normalizeConfig(remoteConfig()),root,webRoot:path.join(root,'missing')});
    t.after(async()=>{await app.close().catch(()=>{});await fs.rm(root,{recursive:true,force:true});});
    await assert.rejects(app.ready,/web|index|ENOENT/i);
});
test('deployment TURN secret overrides the mounted configuration without entering public bootstrap',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-turn-config-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const file=path.join(root,'config.json');await fs.writeFile(file,JSON.stringify(remoteConfig()));
    const result=spawnSync(process.execPath,['-e',`const {loadConfig,publicBootstrap}=require('./src/bootstraps/configManager.js');const config=loadConfig();console.log(JSON.stringify({secret:config.remote.turnSecret,public:publicBootstrap(config)}));`],{cwd:path.resolve(__dirname,'../../est-server'),env:{...process.env,EST_CONFIG_PATH:file,EST_TURN_SECRET:'only-from-private-environment'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.secret,'only-from-private-environment');assert.doesNotMatch(JSON.stringify(value.public),/only-from-private-environment|turnSecret/);
});
test('configured expiring TURN URLs cannot silently run without their shared secret',()=>{
    const raw=remoteConfig();raw.remote.turnUrls=['turn:turn.example.org:3478?transport=udp'];raw.remote.turnSecret='';
    assert.throws(()=>normalizeConfig(raw),/TURN.*secret|turnSecret/i);
});
