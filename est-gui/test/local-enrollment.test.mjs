import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {loadLocalEnrollment} from '../src/main/lib/enrollment.js';
const require=createRequire(import.meta.url);
const {checkoutPaths}=require('../../est-common/transient-paths.cjs');
const {createCoordinator}=require('../../est-server/src/server.js');
const {normalizeConfig}=require('../../est-server/src/bootstraps/configManager.js');
const {localConfig}=require('../../est-server/test/fixtures/config.js');

it('native bootstrap resumes an unfinished run but saves new credentials when the previous run ended',async()=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','est-local-enrollment-');
    const app=createCoordinator({config:normalizeConfig(localConfig()),root:path.join(root,'results')});await app.ready;
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port;
    const options=identity=>({url,identity,ipAddress:'127.0.0.1',operatingSystem:'linux',credentialsPath:path.join(root,identity+'.json')});
    try {
        const a=await loadLocalEnrollment(options('client-a')),b=await loadLocalEnrollment(options('client-b'));
        const session=app.registry.createPair([a,b].map(person=>app.enrollments.get(person.credentials.participantId)));
        expect(await loadLocalEnrollment(options('client-a'))).toEqual(a);
        await app.recovery.end(session,'technicalFailure');
        const renewed=await loadLocalEnrollment(options('client-a'));
        expect(renewed.credentials.participantId).not.toBe(a.credentials.participantId);
        expect(JSON.parse(await fs.readFile(options('client-a').credentialsPath,'utf8'))).toEqual(renewed);
        expect(app.enrollments.authenticate(a.credentials.reconnectToken).outcome).toBe('technicalFailure');
    } finally {await app.close();await fs.rm(root,{recursive:true,force:true});}
});
