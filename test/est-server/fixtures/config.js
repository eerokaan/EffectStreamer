const localExample = require('../../../est-server/est-server.config.local.example.json');
function localConfig() { return structuredClone(localExample); }
function remoteConfig() {
    const raw=localConfig();
    raw.server.mode='remote';raw.server.maxActivePairs=4;
    raw.sessions.general.audioSetup=true;
    raw.remote.turnSecret='private-secret';raw.remote.iceServers=[{urls:'stun:stun.example.org:3478'}];
    return raw;
}
function pretestAnswers() { return {'input-age':25,'select-gender':'other','select-german-proficiency':'native','select-hours-internet':'less-than-3h','select-hours-calls':'less-than-3h'}; }
module.exports = {localConfig,remoteConfig,pretestAnswers};
