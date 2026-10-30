const base = require('../../config-server.example.json');
function localConfig() { return structuredClone(base); }
function remoteConfig() { return {...localConfig(), deployment:{mode:'remote',maxActivePairs:4},audioSetup:{enabled:true},remote:{coreExecutable:'/private/core',turnSecret:'private-secret',iceServers:[{urls:'stun:stun.example.org:3478'}]}}; }
module.exports = {localConfig,remoteConfig};
