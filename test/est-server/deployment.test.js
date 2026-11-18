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

for (const language of ['de','en']) test(`remote coordinator serves the ${language} public bootstrap and Socket.IO without hosting the UI`,async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-api-only-');
    const raw=remoteConfig();raw.sessions.general.language=language;
    const app=createCoordinator({config:normalizeConfig(raw),root});
    t.after(async()=>{try {await app.close();} finally {await fs.rm(root,{recursive:true,force:true});}});
    await app.ready;app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port;
    const config=await fetch(url+'/api/config');assert.equal(config.status,200);assert.match(config.headers.get('cache-control'),/no-store/);
    const bootstrap=await config.json();assert.equal(bootstrap.mode,'remote');assert.equal(bootstrap.sessionLanguage,language);assert.ok(!Object.hasOwn(bootstrap,'testAsset'));
    assert.doesNotMatch(JSON.stringify(bootstrap),/private-secret|completionCodes|coreExecutable/);
    for(const route of ['/','/experiment','/audio/P501_C_english_f1_FB_48k.wav','/assets/missing.js','/api/unknown','/session.json','/src/server.js']) assert.equal((await fetch(url+route)).status,404,route);
    const person=app.enrollments.admit({identity:'websocket-smoke'}),socket=connect(url,{auth:{reconnectToken:person.reconnectToken},transports:['websocket'],reconnection:false});t.after(()=>socket.disconnect());
    await once(socket,'connect',{signal:AbortSignal.timeout(5000)});assert.equal(socket.io.engine.transport.name,'websocket');
});

test('TURN credentials use the private server configuration without exposing its secret in public bootstrap',async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-turn-config-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const directory=path.join(root,'effectstreamer');await fs.mkdir(directory);
    await fs.writeFile(path.join(directory,'est-server.config.json'),JSON.stringify(remoteConfig()));
    const result=spawnSync(process.execPath,['-e',`const {loadConfig,publicBootstrap}=require('./src/bootstraps/configManager.js');const config=loadConfig();console.log(JSON.stringify({secret:config.remote.turnSecret,public:publicBootstrap(config)}));`],{cwd:path.resolve(__dirname,'../../est-server'),env:{...process.env,HOME:root,USERPROFILE:root},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.secret,'private-secret');assert.doesNotMatch(JSON.stringify(value.public),/private-secret|turnSecret/);
});
test('configured expiring TURN URLs cannot silently run without their shared secret',()=>{
    const raw=remoteConfig();raw.remote.turnUrls=['turn:turn.example.org:3478?transport=udp'];raw.remote.turnSecret='';
    assert.throws(()=>normalizeConfig(raw),/TURN.*secret|turnSecret/i);
});
