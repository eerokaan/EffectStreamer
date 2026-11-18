const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { generateKeyPairSync, sign, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { Prolific, assertDesktop } = require("../../est-server/src/services/Prolific.js");
const { EnrollmentStore } = require("../../est-server/src/services/EnrollmentStore.js");
const { normalizeConfig } = require("../../est-server/src/bootstraps/configManager.js");
const { remoteConfig } = require("./fixtures/config.js");
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const desktop = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/145", platform: "Linux x86_64", maxTouchPoints: 0, mobile: false };
const query = id => ({ PROLIFIC_PID: "person-" + id, STUDY_ID: "study-1", SESSION_ID: "submission-" + id });
function rawConfig() {
    const raw = remoteConfig();raw.server.maxActivePairs = 1;raw.conditions = { baseline: [{}], random: [] };raw.tests["listening-speaking-test"] = false;
    raw.prolific = { enabled: true, studyId: "study-1", completionCodes: { completed: "FINISH", technicalFailure: "TECH", partnerLeft: "LEFT", waitingTimeout: "WAIT" } };
    return raw;
}
function fixture(t, raw = rawConfig(), extra = {}) {
    const root = checkoutPaths().temporaryDirectory('est-server','est-prolific-');t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const config = normalizeConfig(raw), enrollments = new EnrollmentStore(root);
    const prolific = new Prolific({ config, enrollments, getSession: () => null, ...extra });return { root, config, enrollments, prolific };
}
test("Prolific IDs bind to a durable enrollment; wrong study, missing IDs, and duplicate submission fail", async t => {
    const { prolific, enrollments } = fixture(t);
    const admitted = await prolific.enroll({ query: query("one"), device: desktop });
    const participant = enrollments.authenticate(admitted.reconnectToken);
    assert.deepEqual(participant.recruitment, { prolificPid: "person-one", studyId: "study-1", submissionId: "submission-one", verified: false });
    assert.notEqual(participant.participantId, "person-one");
    await assert.rejects(prolific.enroll({ query: query("one"), device: desktop }), /already enrolled/);
    for (const change of [{ STUDY_ID: "other" }, { SESSION_ID: "" }, { PROLIFIC_PID: null }]) await assert.rejects(prolific.enroll({ query: { ...query("two"), ...change }, device: desktop }), /study|identifier/i);
});
test("phones and tablets, including desktop-style iPads, are excluded without inspecting viewport size", () => {
    for (const device of [{ userAgent: "iPhone" }, { userAgent: "Android tablet" }, { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 }, { ...desktop, mobile: true }]) assert.throws(() => assertDesktop(device), /desktop|tablet|phone/i);
    assert.doesNotThrow(() => assertDesktop({ ...desktop, width: 320, height: 480 }));
    assert.doesNotThrow(() => assertDesktop({ userAgent: "Windows NT", platform: "Win32", maxTouchPoints: 10 }));
});
test("secured URLs use Prolific RS256/KID/issuer/audience/workspace and reject tampering or expiration", async t => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
    const raw = rawConfig();raw.prolific.secureUrls = true;raw.prolific.externalStudyUrl = "https://study.example/experiment";raw.prolific.workspaceId = "workspace-1";
    const { prolific } = fixture(t, raw, { jwks: { keys: [key] } });
    const now = Math.floor(Date.now() / 1000), ids = query("signed");
    const payload = { iss: "https://www.prolific.com", iat: now, exp: now + 120, aud: "https://study.example/experiment?" + new URLSearchParams(ids), sub: ids.SESSION_ID, prolific: { ...ids, workspace_id: "workspace-1" } };
    const token = (changes = {}, header = {}) => {const data = [Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key", ...header })).toString("base64url"), Buffer.from(JSON.stringify({ ...payload, ...changes })).toString("base64url")].join(".");return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");};
    for (const [changes, header] of [[{ exp: now - 1 }, {}], [{ iss: "https://attacker.example" }, {}], [{ aud: "https://attacker.example/experiment" }, {}], [{ prolific: { ...payload.prolific, workspace_id: "other" } }, {}], [{}, { alg: "HS256" }], [{}, { kid: "unknown" }]]) await assert.rejects(prolific.enroll({ query: { ...ids, prolific_token: token(changes, header) }, device: desktop }), /token|signature|claim|JWT|key|audience|workspace|algorithm|exp|issuer/i);
    await assert.rejects(prolific.enroll({ query: { ...ids, SESSION_ID: "tampered", prolific_token: token() }, device: desktop }), /match|token|claim/i);
    await assert.rejects(prolific.enroll({ query: { ...ids, PROLIFIC_TOKEN: token() }, device: desktop }), /token.*required/i);
    const enrolled = await prolific.enroll({ query: { ...ids, prolific_token: token() }, device: desktop });assert.ok(enrolled.reconnectToken);
});
test("FIFO contains only setup/pretest-ready participants and duplicate readiness cannot consume two places", t => {
    const { enrollments } = fixture(t);const people = [1, 2, 3].map(index => enrollments.admit({ identity: "queue-" + index }));
    assert.throws(() => enrollments.ready(people[0].participantId), /setup|pretest/i);
    for (const person of people) {const record = enrollments.get(person.participantId);record.setupComplete = true;record.pretestComplete = true;}
    enrollments.ready(people[1].participantId);enrollments.ready(people[0].participantId);enrollments.ready(people[1].participantId);enrollments.ready(people[2].participantId);
    assert.deepEqual(enrollments.nextPair().map(person => person.participantId), [people[1].participantId, people[0].participantId]);
});
test("waiting expiry offers only its server-selected early-exit code", async t => {
    let time = 1000;const { prolific, enrollments, config } = fixture(t, rawConfig(), { now: () => time });
    const person = await prolific.enroll({ query: query("wait"), device: desktop });
    const record = enrollments.get(person.participantId);record.setupComplete = true;record.pretestComplete = true;enrollments.ready(record.participantId, time);
    await assert.rejects(prolific.completion(record.participantId), /available|complete/i);
    time += config.sessions.pairingTimeoutMs + 1;prolific.expireWaiting();
    assert.deepEqual(await prolific.completion(record.participantId), { url: "https://app.prolific.com/submissions/complete?cc=WAIT", code: "WAIT", outcome: "waitingTimeout" });
});
test('abandoned pre-setup admissions expire durably and release HTTP admission capacity',async t=>{
    const {createCoordinator}=require('../../est-server/src/server.js');const raw=rawConfig();raw.sessions.pairingTimeoutMs=1000;
    const root=checkoutPaths().temporaryDirectory('est-server','est-admission-expiry-'),app=createCoordinator({config:normalizeConfig(raw),root});await app.ready;
    let time=1000;app.enrollments.now=()=>time;app.prolific.now=()=>time;
    // Exercise the actual fixed 100-person limit, not a configurable test shortcut.
    for(let index=0;index<99;index++)app.enrollments.admit({identity:'waiting-'+index});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port;
    t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
    const enroll=id=>fetch(url+'/api/enrollment',{method:'POST',headers:{'content-type':'application/json','user-agent':desktop.userAgent},body:JSON.stringify({query:query(id),device:desktop})});
    const first=await enroll('abandoned');assert.equal(first.status,201);const credentials=await first.json();
    assert.equal((await enroll('blocked')).status,503);
    time=2001;assert.equal((await enroll('replacement')).status,201);
    const record=app.enrollments.get(credentials.participantId);assert.equal(record.readyAt,null);assert.equal(record.outcome,'waitingTimeout');
    assert.equal(new EnrollmentStore(root).get(record.participantId).outcome,'waitingTimeout');
    assert.equal((await app.prolific.completion(record.participantId)).code,'WAIT');
});
test('valid pre-pair progress renews inactivity but cannot extend the ready-queue deadline',async t=>{
    const {AdmissionFlow}=require('../../est-server/src/services/AdmissionFlow.js');let time=1000;
    const f=fixture(t,rawConfig(),{now:()=>time});f.enrollments.now=()=>time;
    const person=await f.prolific.enroll({query:query('active'),device:desktop});
    const admission=new AdmissionFlow({config:f.config,enrollments:f.enrollments,prolific:f.prolific,registry:{sessions:new Map(),getForParticipant:()=>null}});t.after(()=>admission.close());
    time+=f.config.sessions.pairingTimeoutMs-1;
    await admission.dispatch(person.participantId,{version:1,requestId:randomUUID(),participantId:person.participantId,sessionId:null,attemptId:null,type:'setupComplete',payload:{inputUsable:true,playbackConfirmed:true}});
    assert.equal(f.enrollments.get(person.participantId).admissionLastActiveAt,time);
    time+=2;f.prolific.expireWaiting();const record=f.enrollments.get(person.participantId);assert.equal(record.outcome,null);
    record.pretestComplete=true;f.enrollments.ready(record.participantId,time);const queuedAt=time;
    record.admissionLastActiveAt=queuedAt+f.config.sessions.pairingTimeoutMs;
    time=queuedAt+f.config.sessions.pairingTimeoutMs+1;f.prolific.expireWaiting();assert.equal(record.outcome,'waitingTimeout');
});
test("authenticated pre-pair setup and questionnaire stage before capacity-aware pairing", async t => {
    const { createCoordinator } = require("../../est-server/src/server.js");const { io: connect } = require("socket.io-client");
    const raw = rawConfig();raw.pretestForm = [{ name: "age", type: "input", inputType: "number", label: "Age", validation: { valueType: "integer", min: 18 } }];
    const root=checkoutPaths().temporaryDirectory('est-server','est-prolific-lobby-'),config=normalizeConfig(raw);const app = createCoordinator({ config, root });app.server.listen(0, "127.0.0.1");await once(app.server, "listening");const sockets=[];
    t.after(async()=>{for(const socket of sockets)socket.disconnect();await app.close();fs.rmSync(root,{recursive:true,force:true});});
    const url = "http://127.0.0.1:" + app.server.address().port;
    async function enroll(index) {
        const response = await fetch(url + "/api/enrollment", { method: "POST", headers: { "content-type": "application/json", "user-agent": desktop.userAgent }, body: JSON.stringify({ query: query(index), device: desktop }) });
        assert.equal(response.status, 201, await response.clone().text());const credentials = await response.json();
        const socket = connect(url, { auth: { reconnectToken: credentials.reconnectToken }, transports: ["websocket"], reconnection: false });sockets.push(socket);await once(socket,"connect");return { ...credentials, socket };
    }
    const people = await Promise.all([1,2,3,4].map(enroll));
    async function action(person,type,payload={}) {const result=await person.socket.timeout(2000).emitWithAck('est-event:action',{version:1,requestId:randomUUID(),participantId:person.participantId,sessionId:null,attemptId:null,type,payload});return result;}
    const bypass=await action(people[0],'nextView',{currentView:'viewWelcome'});assert.equal(bypass.ok,false);
    for(const person of people) {
        assert.equal((await action(person,'setupComplete',{inputUsable:true,playbackConfirmed:true})).ok,true);
        assert.equal((await action(person,'nextView',{currentView:'viewWelcome'})).ok,true);
        assert.equal((await action(person,'pretest',{formData:{}})).ok,false);
        assert.equal((await action(person,'pretest',{formData:{age:25}})).ok,true);
        assert.equal((await action(person,'nextView',{currentView:'viewPretest'})).ok,true);
    }
    assert.equal(app.registry.sessions.size,1);const session=app.registry.getForParticipant(people[0].participantId);
    assert.equal(app.registry.getForParticipant(people[1].participantId),session);assert.equal(app.registry.getForParticipant(people[2].participantId),undefined);
    assert.equal(session.snapshot(people[0].participantId).currentView,'viewShortConversationTestExplanation');
    await assert.rejects(app.prolific.completion(people[0].participantId),/available|complete/i);
    session.phase='ended';session.outcome='completed';await assert.rejects(app.prolific.completion(people[0].participantId),/responses|recordings|complete/i);
});
test('normal completion remains unavailable until both questionnaires, all ratings and four matching receipts exist',async t=>{
    const {SessionRegistry}=require('../../est-server/src/services/SessionRegistry.js');const f=fixture(t);
    const people=await Promise.all(['first','second'].map(id=>f.prolific.enroll({query:{...query(id),PROLIFIC_PID:'external/../'+id},device:desktop})));
    const registry=new SessionRegistry({config:f.config,io:{to:()=>({emit(){}})},root:f.root,enrollments:f.enrollments});
    f.prolific.getSession=id=>registry.getForParticipant(id);
    const session=registry.createPair(people.map(person=>f.enrollments.get(person.participantId)));session.phase='ended';session.outcome='completed';
    for(const person of people) {const client=session.clientsData.get(person.participantId);client.setupComplete=true;client.pretestComplete=true;}
    await assert.rejects(f.prolific.completion(people[0].participantId),/complete/);
    const attempt={attemptId:'attempt-success',conditionIndex:0,testType:'sct',roundSuffix:'',status:'completed',answers:[],recordings:[],receipts:[]};session.attempts.push(attempt);
    for(const person of people) {
        attempt.answers.push({participantId:person.participantId,values:Object.fromEntries(['audio_quality','noisiness','discontinuity','coloration','loudness','echo','degradation','interaction'].map(key=>[key,.5]))});
        for(const track of ['microphone','headphones']) {
            const manifest={recordingId:randomUUID(),participantId:person.participantId,track,status:'complete',sha256:'a'.repeat(64)};attempt.recordings.push(manifest);
            await assert.rejects(f.prolific.completion(person.participantId),/complete/);
            attempt.receipts.push({recordingId:manifest.recordingId,sha256:manifest.sha256,stored:true});
        }
    }
    assert.deepEqual(await f.prolific.completion(people[0].participantId),{url:'https://app.prolific.com/submissions/complete?cc=FINISH',code:'FINISH',outcome:'completed'});
    const client=session.clientsData.get(people[0].participantId);assert.equal(session.viewFlow.getClientConditionAsset(client),'client-a/01.png');
    await session.persist();await session.dispose();
});
