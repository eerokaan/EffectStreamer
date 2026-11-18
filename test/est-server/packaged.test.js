const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {coreEnvironment}=require('../../common/core-environment.cjs');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {remoteConfig}=require('./fixtures/config.js');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const packaged=process.env.EST_PACKAGED_SERVER;
function cleanEnv(home){return {HOME:home,USERPROFILE:home,PATH:'/no-external-node',EST_SERVER_TYPE:'media-worker'};}
function message(child,predicate,timeout=20000){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('Packaged process message timeout')),timeout);
    const read=value=>{if(predicate(value))finish(null,value);},exit=code=>finish(new Error('Packaged process exited '+code));
    function finish(error,value){clearTimeout(timer);child.off('message',read);child.off('exit',exit);error?reject(error):resolve(value);}
    child.on('message',read);child.once('exit',exit);
});}
async function reap(child){if(child.exitCode!==null||child.signalCode!==null)return;const closed=once(child,'close');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),10000);await closed;clearTimeout(timer);}

test('SEA worker starts four bundled cores with loss enabled and no external Node or SDK environment',{skip:!packaged,timeout:45000},async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-sea-worker-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const executable=path.resolve(packaged),child=spawn(executable,[],{cwd:root,env:cleanEnv(root),stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);t.after(()=>reap(child));
    await message(child,value=>value.event==='worker-ready');
    let sequence=0;
    const request=async(method,payload,config)=>{const id=String(++sequence),pending=message(child,value=>value.id===id);child.send({id,method,payload,config});const result=await pending;assert.equal(result.ok,true,result.error+' '+stderr);return result.result;};
    const config={coreExecutable:path.join(path.dirname(executable),'core','est-core'),icePortRange:[48000,48499],iceServers:[],startupTimeoutMs:15000,stopTimeoutMs:7000,jitterMs:20,opusBitrate:128000,rtpFrames:128};
    await request('prepare',{sessionId:'packaged-pair',attemptId:'packaged-attempt',participants:['packaged-a','packaged-b'],condition:{packetlossType:'random',packetlossRatio:0.1,packetlossSeed:12},endpoints:[36300,36301,36302,36303,36304,36305]},config);
    const health=await request('health');assert.equal(health.children.length,4);const pids=health.children.map(child=>child.pid);
    await request('stop');assert.equal((await request('health')).children.length,0);
    for(const pid of pids)assert.throws(()=>process.kill(pid,0),/ESRCH/);
    await request('dispose');await once(child,'close');assert.equal(child.exitCode,0,stderr);
});
test('staged Linux native utilities reopen ALSA null and decode both external P.501 samples',{skip:!packaged,timeout:15000},async t=>{
    const root=checkoutPaths().temporaryDirectory('est-server','est-staged-native-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const base=path.dirname(path.resolve(packaged)),executable=path.join(base,'core','est-core'),env=coreEnvironment({executable,env:cleanEnv(root)});
    for(const args of [
        ['--mode','test-input','--device-type','alsa','--device-id','null','--test-duration-ms','50'],
        ...['german','english'].map(language=>['--mode','test-output','--device-type','alsa','--device-id','null','--test-file',path.resolve(__dirname,`../../est-gui/src/shared/public/audio/P501_C_${language}_f1_FB_48k.wav`)])
    ]) {const result=spawnSync(executable,args,{env,cwd:root,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);}
});
test('SEA coordinator serves API and Socket.IO without a bundled web directory',{skip:!packaged,timeout:30000},async t=>{
    await assert.rejects(fs.stat(path.join(path.dirname(path.resolve(packaged)),'web')),{code:'ENOENT'});
    const root=checkoutPaths().temporaryDirectory('est-server','est-sea-server-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    const raw=remoteConfig();delete raw.remote;raw.server={...raw.server,ipAddress:'127.0.0.1',port};raw.sessions.general.language='en';
    raw.prolific={enabled:true,studyId:'sea-study',completionCodes:{completed:'DONE',technicalFailure:'TECH',partnerLeft:'LEFT',waitingTimeout:'WAIT'},secureUrls:true,externalStudyUrl:'https://study.example.org/',workspaceId:'sea-workspace'};
    const home=path.join(root,'home'),directory=path.join(home,'effectstreamer');await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'est-server.config.json'),JSON.stringify(raw));
    const child=spawn(path.resolve(packaged),[],{cwd:root,env:{...cleanEnv(home),EST_SERVER_TYPE:'server'},stdio:['ignore','pipe','pipe']});t.after(()=>reap(child));let stderr='',stdout='';child.stderr.on('data',bytes=>stderr+=bytes);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),15000);child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.includes('Listening on')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr));});});
    const url='http://127.0.0.1:'+port;
    const invalidToken=Buffer.from(JSON.stringify({alg:'HS256',kid:'test'})).toString('base64url')+'.'+Buffer.from('{}').toString('base64url')+'.AAAA';
    const admission=await fetch(url+'/api/enrollment',{method:'POST',headers:{'content-type':'application/json','user-agent':'Mozilla/5.0 (X11; Linux x86_64)'},body:JSON.stringify({query:{PROLIFIC_PID:'sea-person',STUDY_ID:'sea-study',SESSION_ID:'sea-submission',prolific_token:invalidToken},device:{platform:'Linux',maxTouchPoints:0}})});
    assert.equal(admission.status,409);assert.match((await admission.json()).error,/algorithm|alg.*allowed/i,'SEA must include its secured-URL verifier, not fail on a missing JS chunk');
    const config=await(await fetch(url+'/api/config')).json();assert.equal(config.mode,'remote');assert.equal(config.remote,undefined);
    assert.equal(config.sessionLanguage,'en');assert.ok(!Object.hasOwn(config,'testAsset'));
    for(const route of ['/', '/experiment', '/audio/P501_C_german_f1_FB_48k.wav', '/audio/P501_C_english_f1_FB_48k.wav']) assert.equal((await fetch(url+route)).status,404,route);
    const handshake=await fetch(url+'/socket.io/?EIO=4&transport=polling');assert.equal(handshake.status,200);
    const packet=await handshake.text();assert.equal(packet[0],'0');assert.ok(JSON.parse(packet.slice(1)).upgrades.includes('websocket'));
    await reap(child);assert.equal(child.exitCode,0,stderr);
});
