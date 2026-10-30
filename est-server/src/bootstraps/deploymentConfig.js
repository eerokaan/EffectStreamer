const {configError,validateObject,validateKnownKeys,normalizeNumeric,normalizeString} = require('../utils/validation.js');

function section(raw, name, defaults) {
    const value = raw[name] === undefined ? {} : raw[name];
    validateObject(value, name);
    validateKnownKeys(value, Object.keys(defaults), name);
    return {...defaults,...value};
}
function integer(value, name, min = 1, max = 2147483647) { return normalizeNumeric(value,name,{integer:true,min,max}); }
function boolean(value, name) { if (typeof value !== 'boolean') configError(name,'must be boolean'); return value; }
function range(value, name) {
    if (!Array.isArray(value) || value.length !== 2) configError(name,'must be [first,last]');
    const ports=value.map(n => integer(n,name,1024,65535));
    if (ports[0]>ports[1]) configError(name,'must be ordered');
    return ports;
}
function normalizeDeployment(raw) {
    const deployment=section(raw,'deployment',{mode:'local',maxActivePairs:1,allowDevelopmentAdmission:false});
    if (!['local','remote'].includes(deployment.mode)) configError('deployment.mode','must be local or remote');
    deployment.maxActivePairs=integer(deployment.maxActivePairs,'deployment.maxActivePairs',1,1000);
    boolean(deployment.allowDevelopmentAdmission,'deployment.allowDevelopmentAdmission');
    const audioSetup=section(raw,'audioSetup',{enabled:deployment.mode === 'remote',testAsset:'P501_C_german_f1_FB_48k.wav'});
    boolean(audioSetup.enabled,'audioSetup.enabled');
    if (deployment.mode === 'remote' && !audioSetup.enabled) configError('audioSetup.enabled','cannot be false remotely');
    if (typeof audioSetup.testAsset !== 'string' || !/^[A-Za-z0-9_-]+\.wav$/.test(audioSetup.testAsset)) configError('audioSetup.testAsset','must be a WAV asset filename');
    const sessions=section(raw,'sessions',{pairingTimeoutMs:300000,reconnectGraceMs:60000,maxRetries:1});
    for (const key of Object.keys(sessions)) sessions[key]=integer(sessions[key],'sessions.'+key,key==='maxRetries'?0:1,key==='maxRetries'?10:2147483647);
    const recordings=section(raw,'recordings',{maxConditionSeconds:600,maxBytesPerParticipant:134217728,uploadTimeoutMs:600000,chunkBytes:1048576});
    for (const key of Object.keys(recordings)) recordings[key]=integer(recordings[key],'recordings.'+key,1,key==='chunkBytes'?4194304:2147483647);
    if (recordings.maxConditionSeconds*48000*2*2+88>recordings.maxBytesPerParticipant) configError('recordings.maxBytesPerParticipant','must hold both WAV tracks for maxConditionSeconds');
    const remote=section(raw,'remote',{coreExecutable:'/opt/effectstreamer/core/est-core',internalPortRange:[40000,49999],icePortRange:[50000,59999],playbackDrainMs:250,iceServers:[],turnSecret:'',turnUrls:[],startupTimeoutMs:30000,stopTimeoutMs:7000,jitterMs:20,opusBitrate:128000,rtpFrames:128});
    remote.coreExecutable=normalizeString(remote.coreExecutable,'remote.coreExecutable');
    remote.internalPortRange=range(remote.internalPortRange,'remote.internalPortRange');
    remote.icePortRange=range(remote.icePortRange,'remote.icePortRange');
    if (remote.internalPortRange[0]<=remote.icePortRange[1] && remote.icePortRange[0]<=remote.internalPortRange[1]) configError('remote','port ranges overlap');
    remote.playbackDrainMs=integer(remote.playbackDrainMs,'remote.playbackDrainMs',0,60000);
    remote.startupTimeoutMs=integer(remote.startupTimeoutMs,'remote.startupTimeoutMs',100,120000);
    remote.stopTimeoutMs=integer(remote.stopTimeoutMs,'remote.stopTimeoutMs',100,120000);
    remote.jitterMs=integer(remote.jitterMs,'remote.jitterMs',0,2000);
    remote.opusBitrate=integer(remote.opusBitrate,'remote.opusBitrate',6000,510000);
    remote.rtpFrames=integer(remote.rtpFrames,'remote.rtpFrames',1,480);
    if (typeof remote.turnSecret !== 'string' || !Array.isArray(remote.turnUrls) || remote.turnUrls.some(url=>typeof url !== 'string' || !/^turns?:[^\s]+$/.test(url))) configError('remote','invalid TURN settings');
    if (!Array.isArray(remote.iceServers)) configError('remote.iceServers','must be an array');
    remote.iceServers=remote.iceServers.map(server=>{
        validateObject(server,'remote.iceServers'); validateKnownKeys(server,['urls','username','credential'],'remote.iceServers');
        const urls=Array.isArray(server.urls)?server.urls:[server.urls];
        if (!urls.length || urls.some(url=>typeof url !== 'string' || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) configError('remote.iceServers.urls','must contain ICE URLs');
        for (const key of ['username','credential']) if(server[key] !== undefined && typeof server[key] !== 'string') configError('remote.iceServers.'+key,'must be string');
        return {...server,urls:[...urls]};
    });
    const prolific=section(raw,'prolific',{enabled:false,studyId:'',completionCodes:{completed:'',technicalFailure:'',partnerLeft:'',waitingTimeout:''}});
    boolean(prolific.enabled,'prolific.enabled');
    validateObject(prolific.completionCodes,'prolific.completionCodes');
    const outcomes=['completed','technicalFailure','partnerLeft','waitingTimeout'];
    validateKnownKeys(prolific.completionCodes,outcomes,'prolific.completionCodes');
    prolific.completionCodes={...Object.fromEntries(outcomes.map(key=>[key,''])),...prolific.completionCodes};
    if (typeof prolific.studyId !== 'string' || Object.values(prolific.completionCodes).some(value=>typeof value !== 'string')) configError('prolific','invalid identifiers/codes');
    if (prolific.enabled && (!prolific.studyId.trim() || outcomes.some(key=>!prolific.completionCodes[key].trim()))) configError('prolific','requires studyId and every outcome completion code');
    return {deployment,audioSetup,sessions,recordings,remote,prolific};
}
function publicBootstrap(config) {
    return {version:1,mode:config.deployment.mode,setupRequired:config.audioSetup.enabled,testAsset:'/audio/'+config.audioSetup.testAsset,recordings:{...config.recordings}};
}
module.exports = {normalizeDeployment,publicBootstrap};
