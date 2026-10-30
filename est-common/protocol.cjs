// Browser-safe contracts: this entry must not import Node modules.
const PROTOCOL_VERSION = 1;
const RECORDING_TRACKS = Object.freeze(['microphone', 'headphones']);
const ACTIONS = Object.freeze(['ready', 'setupComplete', 'pretest', 'submitRating', 'nextView', 'stopCondition', 'leave',
    'mediaPrepared', 'mediaStarted', 'mediaStopped', 'mediaFailed', 'recordingsFinalized', 'signal']);
const EVENTS = Object.freeze(Object.fromEntries(['snapshot', 'action', 'mediaCommand', 'mediaResult', 'signal', 'recordingRequest', 'recordingReceipt'].map(name => [name, 'est-event:' + name])));

function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ' + name);
    return value;
}
function identifier(value, name) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid ' + name);
    return value;
}
function validateScope(value, {prePair = false} = {}) {
    object(value, 'scope');
    identifier(value.participantId, 'participantId');
    if (prePair && value.sessionId === null && value.attemptId === null) return value;
    identifier(value.sessionId, 'sessionId');
    if (value.attemptId !== null) identifier(value.attemptId, 'attemptId');
    return value;
}
function validateEnvelope(value) {
    validateScope(value, {prePair: true});
    if (value.version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    identifier(value.requestId, 'requestId');
    if (!ACTIONS.includes(value.type)) throw new Error('Unknown action');
    object(value.payload, 'payload');
    return value;
}
function validateManifest(value) {
    validateScope(value);
    identifier(value.attemptId, 'attemptId');
    identifier(value.recordingId, 'recordingId');
    const fields = new Set(['recordingId','sessionId','participantId','attemptId','track','filename','source','contentType','byteLength','sha256','status']);
    if (Object.keys(value).some(key => !fields.has(key))) throw new Error('Unknown recording manifest field');
    if (!RECORDING_TRACKS.includes(value.track) || value.filename !== value.track + '.wav') throw new Error('Invalid recording track or filename');
    if (!['local-file','browser-memory'].includes(value.source) || value.contentType !== 'audio/wav') throw new Error('Invalid recording source or content type');
    if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 44) throw new Error('Invalid recording byteLength');
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid recording sha256');
    if (!['complete','interrupted'].includes(value.status)) throw new Error('Invalid recording status');
    return value;
}
module.exports = {PROTOCOL_VERSION,RECORDING_TRACKS,ACTIONS,EVENTS,object,identifier,validateScope,validateEnvelope,validateManifest};
