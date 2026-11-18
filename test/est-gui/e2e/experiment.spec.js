import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {checkoutPaths}=require('../../../common/transient-paths.cjs');
const {createCoordinator}=require('../../../est-server/src/server.js');
const {normalizeConfig,publicBootstrap}=require('../../../est-server/src/bootstraps/configManager.js');
const {iceArguments}=require('../../../est-server/src/media/MediaWorker.js');
const {remoteConfig}=require('../../est-server/fixtures/config.js');

const tones=[440,660,880,1100];
function acceptanceConfig(raw,env=process.env) {
    const config=normalizeConfig(raw);
    if(env.EST_ACCEPTANCE_ICE_SERVERS)config.remote.iceServers=JSON.parse(env.EST_ACCEPTANCE_ICE_SERVERS);
    Object.assign(config.remote,{coreExecutable:env.EST_ACCEPTANCE_CORE||env.EST_CORE_EXECUTABLE||checkoutPaths().path('est-core','build','linux','est-core'),internalPortRange:[35400,35499],icePortRange:[48500,48999],playbackDrainMs:100,startupTimeoutMs:30000});
    return config;
}
test('authenticated relay acceptance settings are injected without weakening public config validation',()=>{
    const servers=[{urls:'turn:relay.example.org:3478?transport=udp',username:'relay-user',credential:'relay-password'}];
    const raw=remoteConfig(),config=acceptanceConfig(raw,{EST_ACCEPTANCE_ICE_SERVERS:JSON.stringify(servers)});
    expect(iceArguments(config.remote.iceServers)).toEqual(['--turn-server','turn://relay-user:relay-password@relay.example.org:3478?transport=udp']);
    expect(JSON.stringify(publicBootstrap(config))).not.toMatch(/relay-user|relay-password/);
    expect(()=>normalizeConfig({...remoteConfig(),remote:{iceServers:servers}})).toThrow(/username/);
});
test('an admission that expires before audio setup shows its early exit without a blocking setup dialog',async({browser})=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','est-admission-ui-'),raw=remoteConfig();
    raw.sessions.operatingLimits.pairingTimeoutSeconds=1;raw.prolific={enabled:true,studyId:'expiry-study',completionCodes:{completed:'DONE',technicalFailure:'TECH',partnerLeft:'LEFT',waitingTimeout:'WAIT'}};
    const app=createCoordinator({config:normalizeConfig(raw),root,webRoot:checkoutPaths().path('est-gui','web')});await app.ready;
    let time=1000;app.enrollments.now=()=>time;app.prolific.now=()=>time;
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const context=await browser.newContext(),page=await context.newPage();
    try {
        await page.goto('http://127.0.0.1:'+app.server.address().port+'/?PROLIFIC_PID=expired-person&STUDY_ID=expiry-study&SESSION_ID=expired-submission');
        await expect(page.getByRole('dialog')).toBeVisible();
        time=2001;app.prolific.expireWaiting();app.admission.publish();
        await expect(page.getByRole('link',{name:'Zurück zu Prolific'})).toHaveAttribute('href','https://app.prolific.com/submissions/complete?cc=WAIT');
        await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {await context.close();await app.close();await fs.rm(root,{recursive:true,force:true});}
});
async function syntheticAudio({tone,relay}) {
    window.__acceptancePeers=[];window.__acceptanceSources=[];
    const Peer=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Peer {constructor(config){super({...config,...(relay?{iceTransportPolicy:'relay'}:{})});window.__acceptancePeers.push(this);}};
    navigator.mediaDevices.getUserMedia=async()=>{
        const context=new AudioContext({sampleRate:48000});await context.resume();
        const source=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
        source.frequency.value=tone;gain.gain.value=.2;source.connect(gain);gain.connect(destination);source.start();window.__acceptanceSources.push(context);return destination.stream;
    };
}

for (const locale of [
    { language: 'en', other: 'de', audio: 'english', devices: 'Audio devices', load: 'Load or refresh devices', check: 'Check the microphone and play the P.501 sample', next: 'Continue', welcome: 'Welcome to the experiment', pretest: 'Before we begin', age: 'Age', woman: 'Female' },
    { language: 'de', other: 'en', audio: 'german', devices: 'Audiogeräte', load: 'Geräteliste laden oder aktualisieren', check: 'Mikrofon prüfen und P.501-Hörbeispiel abspielen', next: 'Weiter', welcome: 'Willkommen beim Experiment', pretest: 'Bevor es losgeht', age: 'Alter', woman: 'Weiblich' }
]) {
    test(`remote ${locale.language} selects server language before the device check`, async ({browser}) => {
        const root = checkoutPaths().temporaryDirectory('est-gui','est-localized-admission-');
        const raw = remoteConfig(); raw.sessions.general.language = locale.language;
        raw.pretestForm = raw.pretestForm.filter(field => ['input-age', 'select-gender'].includes(field.name));
        raw.prolific = {enabled:true, studyId:'language-study', completionCodes:{completed:'DONE',technicalFailure:'TECH',partnerLeft:'LEFT',waitingTimeout:'WAIT'}};
        const app = createCoordinator({ config: normalizeConfig(raw), root, webRoot: checkoutPaths().path('est-gui','web') });
        await app.ready; app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
        const context = await browser.newContext({ locale: locale.other });
        await context.addInitScript(syntheticAudio, {tone: 440, relay: false});
        const page = await context.newPage();
        const release = Promise.withResolvers(), requested = Promise.withResolvers();
        await page.route('**/api/config', async route => { requested.resolve(); await release.promise; await route.continue(); });
        try {
            await page.goto(`http://127.0.0.1:${app.server.address().port}/?PROLIFIC_PID=language-person&STUDY_ID=language-study&SESSION_ID=language-submission&language=${locale.other}`, {waitUntil:'domcontentloaded'});
            await requested.promise;
            await expect(page.locator('#root')).toBeEmpty();
            release.resolve();
            await expect(page.locator('html')).toHaveAttribute('lang',locale.language);
            const dialog = page.getByRole('dialog', {name: locale.devices});
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', {name: locale.load}).click();
            const wave = page.waitForResponse(response => response.url().endsWith(`/P501_C_${locale.audio}_f1_FB_48k.wav`));
            await dialog.getByRole('button', {name: locale.check}).click();
            expect((await wave).ok()).toBe(true);
            await dialog.getByRole('checkbox').check({timeout:45000});
            await dialog.getByRole('button', {name: locale.next, exact: true}).click();
            await expect(page.getByRole('heading', {name: locale.welcome})).toBeVisible();
            await page.getByRole('button', {name: locale.next, exact: true}).click();
            await expect(page.getByRole('heading', {name: locale.pretest})).toBeVisible();
            await page.getByLabel(locale.age, {exact:true}).fill('25');
            await page.getByRole('combobox').click();
            await page.getByRole('option', {name: locale.woman, exact:true}).click();
            await page.getByRole('button', {name: locale.next, exact:true}).click();
            await expect.poll(() => [...app.enrollments.participants.values()][0]?.formData).toEqual({'input-age':25,'select-gender':'female'});
        } finally { release.resolve(); await context.close(); await app.close(); await fs.rm(root,{recursive:true,force:true}); }
    });
}
function spectralPower(bytes,hz){let power=0;const frames=(bytes.length-44)/2;
    // Sum short-window power over the whole file: silence at ordinary startup /
    // drain and codec phase changes must not become an alignment certification.
    for(let start=0;start<frames;start+=4800){let real=0,imag=0;const count=Math.min(4800,frames-start);for(let n=0;n<count;n++){const sample=bytes.readInt16LE(44+2*(start+n));real+=sample*Math.cos(2*Math.PI*hz*n/48000);imag+=sample*Math.sin(2*Math.PI*hz*n/48000);}power+=real*real+imag*imag;}
    return power;
}
async function cpuMemory(pids){let ticks=0,rssKb=0;for(const pid of pids){const stat=(await fs.readFile('/proc/'+pid+'/stat','utf8')).split(') ')[1].split(' ');ticks+=Number(stat[11])+Number(stat[12]);const status=await fs.readFile('/proc/'+pid+'/status','utf8');rssKb+=Number(status.match(/^VmRSS:\s+(\d+)/m)[1]);}return {ticks,rssKb};}
async function traffic(pages){const values=await Promise.all(pages.map(page=>page.evaluate(async()=>{let bytes=0;const candidates=[];for(const peer of window.__acceptancePeers.filter(peer=>peer.connectionState==='connected')){const stats=await peer.getStats();for(const value of stats.values()){if(value.type==='transport')bytes+=(value.bytesSent||0)+(value.bytesReceived||0);if(value.type==='candidate-pair'&&value.state==='succeeded'&&value.nominated){const local=stats.get(value.localCandidateId);candidates.push(local?.candidateType);}}}return {bytes,candidates};})));return {bytes:values.reduce((sum,value)=>sum+value.bytes,0),candidates:values.flatMap(value=>value.candidates)};}

test('production frontend runs two concurrent isolated pairs through SCT/LST and receipt-confirmed completion',async({browser},testInfo)=>{
    test.setTimeout(240000);
    const root=checkoutPaths().temporaryDirectory('est-gui','est-production-pairs-'),raw=remoteConfig();
    raw.server.maxActivePairs=2;raw.conditions={baseline:[{echoGain:0,nativeGain:1}],random:[]};
    raw.pretestForm=[{name:'age',type:'input',inputType:'number',label:'Age',validation:{valueType:'integer',min:18}}];
    raw.prolific={enabled:true,studyId:'acceptance-study',completionCodes:{completed:'DONE',technicalFailure:'TECH',partnerLeft:'LEFT',waitingTimeout:'WAIT'}};
    const config=acceptanceConfig(raw);
    const app=createCoordinator({config,root,webRoot:checkoutPaths().path('est-gui','web')});await app.ready;
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port;
    const contexts=[],pages=[],samples=[],allPids=new Set();
    const sessions=()=>[...app.registry.sessions.values()];
    const next=async chosen=>Promise.all(chosen.map(page=>page.getByRole('button',{name:'Weiter',exact:true}).click()));
    const status=async(chosen,value)=>{const active=()=>sessions().filter((_session,index)=>chosen.includes(pages[index*2]));await expect.poll(()=>active().map(session=>session.recordingContexts.get(session.recordingContextActive)?.status),{timeout:45000}).toEqual(chosen.length===4?[value,value]:[value]);
        for(const session of active()){allPids.add(session.mediaAdapter.child.pid);for(const child of (await session.mediaAdapter.request('health')).children)allPids.add(child.pid);}
    };
    async function measure(label,chosen,active){const health=await Promise.all(active.map(session=>session.mediaAdapter.request('health')));const pids=active.flatMap((session,index)=>[session.mediaAdapter.child.pid,...health[index].children.map(core=>core.pid)]);pids.forEach(pid=>allPids.add(pid));
        const before=await cpuMemory(pids),networkBefore=await traffic(chosen),start=Date.now();await new Promise(resolve=>setTimeout(resolve,2000));
        const after=await cpuMemory(pids),networkAfter=await traffic(chosen),seconds=(Date.now()-start)/1000;
        const value={label,pairs:active.length,processes:pids.length,wallSeconds:seconds,cpuTicks:after.ticks-before.ticks,rssKb:after.rssKb,transportBytesPerSecond:(networkAfter.bytes-networkBefore.bytes)/seconds,candidateTypes:networkAfter.candidates};samples.push(value);
        expect(networkAfter.bytes).toBeGreaterThan(networkBefore.bytes);if(process.env.EST_ACCEPTANCE_RELAY==='1')expect(networkAfter.candidates.every(type=>type==='relay')).toBe(true);
    }
    async function confirmSetup(page){
        const dialog=page.getByRole('dialog',{name:'Audiogeräte'});
        await expect(dialog).toBeVisible();await expect(dialog.getByRole('combobox').nth(0)).toContainText(/default|standard/i);await expect(dialog.getByRole('combobox').nth(1)).toContainText(/default|standard/i);
        await dialog.getByRole('button',{name:'Mikrofon prüfen und P.501-Hörbeispiel abspielen'}).click();await dialog.getByRole('checkbox').check({timeout:45000});await dialog.getByRole('button',{name:'Weiter',exact:true}).click();
    }
    async function prepare(index){const context=await browser.newContext({viewport:{width:1280,height:1000}});contexts[index]=context;await context.addInitScript(syntheticAudio,{tone:tones[index],relay:process.env.EST_ACCEPTANCE_RELAY==='1'});const page=await context.newPage();pages[index]=page;
        const partnerNotice=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Der Gesprächspartner hat das Gespräch verlassen'})});
        await page.addLocatorHandler(partnerNotice,async()=>{
            try {await partnerNotice.getByRole('button',{name:'Schließen',exact:true}).click({timeout:3000});}
            catch(error){if(await partnerNotice.isVisible())throw error;} // The peer may finish and unmount the notice first.
        });
        await page.goto(url+'/?PROLIFIC_PID=acceptance-person-'+index+'&STUDY_ID=acceptance-study&SESSION_ID=acceptance-submission-'+index);
        await confirmSetup(page);
        await page.getByRole('heading',{name:'Willkommen beim Experiment'}).waitFor();await next([page]);await page.getByLabel('Alter',{exact:true}).fill('25');await next([page]);
        return page;
    }
    async function ratings(chosen,type){await Promise.all(chosen.map(async page=>{
        const image=page.locator('img[data-rating-scale]');await image.waitFor();
        const person=new URL(page.url()).searchParams.get('PROLIFIC_PID'),client=sessions().flatMap(session=>[...session.clientsData.values()]).find(client=>client.recruitment.prolificPid===person);
        const count=type==='sct'?8:client.viewData.conditionListeningSpeakingTestRole==='speaker'?3:5;
        for(let round=0;round<count;round++){await expect.poll(()=>image.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);await image.locator('..').click({position:{x:200,y:20}});await page.getByRole('button',{name:'Weiter',exact:true}).click();}
    }));}
    try {
        await Promise.all([prepare(0),prepare(1)]);await expect.poll(()=>sessions().length).toBe(1);
        // Reload loses the authorized AudioContext, not the stable partner/role.
        // Recheck setup before starting; this must not spend an audio attempt.
        const membership=[...sessions()[0].clientsData.keys()];await pages[0].reload();
        await expect.poll(()=>sessions()[0].recovery?.kind).toBe('between');
        await confirmSetup(pages[0]);
        await Promise.all(pages.slice(0,2).map(page=>page.getByRole('button',{name:'Bereit für erneuten Versuch mit demselben Partner'}).click()));
        await expect.poll(()=>sessions()[0].phase).toBe('experiment');expect(sessions()[0].attempts).toHaveLength(0);expect([...sessions()[0].clientsData.keys()]).toEqual(membership);
        await next(pages.slice(0,2));await status(pages.slice(0,2),'running');await measure('one pair',pages.slice(0,2),sessions());
        await Promise.all([prepare(2),prepare(3)]);await expect.poll(()=>sessions().length).toBe(2);await next(pages.slice(2));await status(pages,'running');await measure('two pairs',pages,sessions());
        const ids=sessions().map(session=>session.sessionId);expect(new Set(ids).size).toBe(2);
        // Both pairs independently stop/rate SCT, then execute both LST roles.
        await next(pages);await ratings(pages,'sct');await next(pages);await status(pages,'running');
        expect(sessions().map(session=>[...session.clientsData.values()].map(client=>client.viewData.conditionListeningSpeakingTestRole))).toEqual([['speaker','listener'],['speaker','listener']]);
        await new Promise(resolve=>setTimeout(resolve,1000)); // Exercise conversation audio, not only connection/start transients.
        await next(pages);await ratings(pages,'lst');await status(pages,'running');
        expect(sessions().map(session=>[...session.clientsData.values()].map(client=>client.viewData.conditionListeningSpeakingTestRole))).toEqual([['listener','speaker'],['listener','speaker']]);
        await new Promise(resolve=>setTimeout(resolve,1000));
        await next(pages);await ratings(pages,'lst');await expect.poll(()=>sessions().map(session=>session.outcome),{timeout:45000}).toEqual(['completed','completed']);
        for(const page of pages){await expect(page.getByRole('link',{name:'Zurück zu Prolific'})).toHaveAttribute('href','https://app.prolific.com/submissions/complete?cc=DONE');}
        for(const session of sessions()){
            expect(session.attempts).toHaveLength(3);
            for(const attempt of session.attempts){expect(attempt.status).toBe('completed');expect(attempt.receipts).toHaveLength(4);expect(attempt.answers).toHaveLength(2);
                for(const client of session.clientsData.values()){
                    const source=Number(client.recruitment.prolificPid.split('-').at(-1)),partner=source%2?source-1:source+1;
                    const directory=path.join(session.sessionDir,'attempts',attempt.attemptId,client.participantId),files=(await fs.readdir(directory)).sort();expect(files).toEqual(['headphones.wav','microphone.wav']);
                    for(const [track,wanted] of [['microphone',source],['headphones',partner]]){const bytes=await fs.readFile(path.join(directory,track+'.wav'));expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.readUInt32LE(24)).toBe(48000);expect(bytes.readUInt16LE(22)).toBe(1);expect(bytes.readUInt16LE(34)).toBe(16);
                        const powers=tones.map(hz=>spectralPower(bytes,hz)),energy=powers[wanted];
                        if(track==='headphones'&&powers.some((power,index)=>index!==wanted&&power>energy/20)){console.log('Synthetic spectral diagnostic:',JSON.stringify({track,source,wanted,test:attempt.testType+attempt.roundSuffix,powers}));await testInfo.attach('synthetic-'+source+'-'+attempt.testType+attempt.roundSuffix,{body:bytes,contentType:'audio/wav'});}
                        for(let other=0;other<tones.length;other++)if(other!==wanted)expect(energy,JSON.stringify({track,source,wanted,other,test:attempt.testType+attempt.roundSuffix,bytes:bytes.length,powers})).toBeGreaterThan(powers[other]*10);
                    }
                }
            }
        }
        for(const pid of allPids)expect(()=>process.kill(pid,0)).toThrow(/ESRCH/);
        expect(app.registry.ports.leases.size).toBe(0);expect(sessions().every(session=>session.mediaAdapter.child===null)).toBe(true);
        await testInfo.attach('development-resource-sample',{body:JSON.stringify({browser:browser.version(),samples},null,2),contentType:'application/json'});console.log('Acceptance resources:',JSON.stringify({browser:browser.version(),samples}));
    } catch(error){await fs.cp(root,testInfo.outputPath('synthetic-failure-fixture'),{recursive:true});console.error('Production UI diagnostic:',JSON.stringify({sessions:sessions().map(session=>session.manifest()),pages:await Promise.all(pages.map(page=>page.locator('body').innerText().catch(()=>'')))}));throw error;}
    finally {await Promise.allSettled(contexts.map(context=>context.close()));await app.close();await fs.rm(root,{recursive:true,force:true});}
});
