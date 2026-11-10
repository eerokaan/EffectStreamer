const localExample = require('../../../est-server/est-server.config.local.example.json');
function localConfig() { return structuredClone(localExample); }
function remoteConfig() { return {...localConfig(), deployment:{mode:'remote',maxActivePairs:4},audioSetup:{enabled:true},remote:{coreExecutable:'/private/core',turnSecret:'private-secret',iceServers:[{urls:'stun:stun.example.org:3478'}]}}; }
function pretestAnswers() { return {'input-age':25,'select-gender':'other','select-german-proficiency':'native','select-hours-internet':'less-than-3h','select-hours-calls':'less-than-3h'}; }
module.exports = {localConfig,remoteConfig,pretestAnswers};
