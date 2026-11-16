const { configError, validateObject, validateKnownKeys, normalizeNumeric } = require("../utils/validation.js");
const { MEDIA_POLICY, SESSION_POLICY, RECORDING_POLICY, MAX_CONDITION_SECONDS, recordingByteLimit } = require("./runtimePolicy.js");
const { coreExecutable } = require("./resources.js");

function section(raw, name, defaults, configPath = name) {
    const value = raw[name] === undefined ? {} : raw[name];
    validateObject(value, configPath);
    validateKnownKeys(value, Object.keys(defaults), configPath);
    return { ...defaults, ...value };
}
function integer(value, name, min = 1, max = 2147483647) {
    return normalizeNumeric(value, name, { integer: true, min, max });
}
function boolean(value, name) {
    if (typeof value !== "boolean") configError(name, "must be boolean");
    return value;
}
function range(value, name) {
    if (!Array.isArray(value) || value.length !== 2) configError(name, "must be [first,last]");
    const ports = value.map((n) => integer(n, name, 1024, 65535));
    if (ports[0] > ports[1]) configError(name, "must be ordered");
    return ports;
}
function normalizeDeployment(raw, server) {
    // Keep the private runtime model stable while exposing only the compact schema.
    const deployment = { mode: server.mode, maxActivePairs: server.maxActivePairs };
    const settings = section(raw, "sessions", { pairingTimeoutMs: 300000, reconnectGraceMs: 60000, maxRetries: 1, maxConditionSeconds: 600, audioSetup: {} });
    const audioSetup = section(settings, "audioSetup", { enabled: deployment.mode === "remote", testAsset: "P501_C_german_f1_FB_48k.wav" }, "sessions.audioSetup");
    boolean(audioSetup.enabled, "sessions.audioSetup.enabled");
    if (deployment.mode === "remote" && !audioSetup.enabled) configError("sessions.audioSetup.enabled", "cannot be false remotely");
    if (typeof audioSetup.testAsset !== "string" || !/^[A-Za-z0-9_-]+\.wav$/.test(audioSetup.testAsset)) configError("sessions.audioSetup.testAsset", "must be a WAV asset filename");
    const sessions = { ...SESSION_POLICY };
    for (const key of ["pairingTimeoutMs", "reconnectGraceMs", "maxRetries"]) sessions[key] = integer(settings[key], "sessions." + key, key === "maxRetries" ? 0 : 1, key === "maxRetries" ? 10 : 2147483647);
    const maxConditionSeconds = integer(settings.maxConditionSeconds, "sessions.maxConditionSeconds", 1, MAX_CONDITION_SECONDS);
    const recordings = { maxConditionSeconds, maxBytesPerParticipant: recordingByteLimit(maxConditionSeconds), ...RECORDING_POLICY };
    const remote = { ...section(raw, "remote", { icePortRange: [50000, 59999], iceServers: [], turnUrls: [], turnSecret: "" }), ...MEDIA_POLICY, internalPortRange: [...MEDIA_POLICY.internalPortRange], coreExecutable: coreExecutable() };
    remote.icePortRange = range(remote.icePortRange, "remote.icePortRange");
    if (remote.internalPortRange[0] <= remote.icePortRange[1] && remote.icePortRange[0] <= remote.internalPortRange[1]) configError("remote", "port ranges overlap");
    if (typeof remote.turnSecret !== "string" || !Array.isArray(remote.turnUrls) || remote.turnUrls.some((url) => typeof url !== "string" || !/^turns?:[^\s]+$/.test(url))) configError("remote", "invalid TURN settings");
    if (remote.turnUrls.length && !remote.turnSecret.trim()) configError("remote.turnSecret", "TURN URLs require a nonempty shared secret (or EST_TURN_SECRET override)");
    remote.turnUrls = [...remote.turnUrls];
    if (!Array.isArray(remote.iceServers)) configError("remote.iceServers", "must be an array");
    remote.iceServers = remote.iceServers.map((server) => {
        validateObject(server, "remote.iceServers");
        validateKnownKeys(server, ["urls"], "remote.iceServers");
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        if (!urls.length || urls.some((url) => typeof url !== "string" || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) configError("remote.iceServers.urls", "must contain ICE URLs");
        return { ...server, urls: [...urls] };
    });
    const prolific = section(raw, "prolific", { enabled: false, studyId: "", completionCodes: { completed: "", technicalFailure: "", partnerLeft: "", waitingTimeout: "" }, secureUrls: false, externalStudyUrl: "", workspaceId: "", organisationId: null });
    boolean(prolific.enabled, "prolific.enabled");
    boolean(prolific.secureUrls, "prolific.secureUrls");
    if (prolific.secureUrls) {
        let url;
        try {
            url = new URL(prolific.externalStudyUrl);
        }
        catch {
            configError("prolific.externalStudyUrl", "must be an HTTPS study URL");
        }
        if (url.protocol !== "https:" || url.username || url.password || url.hash || !prolific.workspaceId || typeof prolific.workspaceId !== "string" || !(prolific.organisationId === null || typeof prolific.organisationId === "string")) configError("prolific", "invalid secured URL/workspace settings");
    }
    validateObject(prolific.completionCodes, "prolific.completionCodes");
    const outcomes = ["completed", "technicalFailure", "partnerLeft", "waitingTimeout"];
    validateKnownKeys(prolific.completionCodes, outcomes, "prolific.completionCodes");
    prolific.completionCodes = { ...Object.fromEntries(outcomes.map((key) => [key, ""])), ...prolific.completionCodes };
    if (typeof prolific.studyId !== "string" || Object.values(prolific.completionCodes).some((value) => typeof value !== "string")) configError("prolific", "invalid identifiers/codes");
    if (prolific.enabled && (!prolific.studyId.trim() || outcomes.some((key) => !prolific.completionCodes[key].trim()))) configError("prolific", "requires studyId and every outcome completion code");
    return { deployment, audioSetup, sessions, recordings, remote, prolific };
}
function publicBootstrap(config) {
    return { version: 1, mode: config.deployment.mode, setupRequired: config.audioSetup.enabled, testAsset: "/audio/" + config.audioSetup.testAsset, recordings: { ...config.recordings } };
}
module.exports = { normalizeDeployment, publicBootstrap };
