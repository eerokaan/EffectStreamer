const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvelope, validateManifest } = require('../../common/protocol.cjs');

const scope = { sessionId: 's-1', participantId: 'p-1', attemptId: 'a-1' };
test('actions accept known scoped requests and reject unknown or invalid membership identifiers', () => {
    const request = { version: 1, requestId: 'r-1', ...scope, type: 'ready', payload: {} };
    assert.deepEqual(validateEnvelope(request), request);
    for (const change of [{version: 2}, {type: 'run-shell'}, {sessionId: '../other'}, {requestId: ''}, {participantId: null}]) {
        assert.throws(() => validateEnvelope({...request, ...change}));
    }
    assert.doesNotThrow(() => validateEnvelope({...request, sessionId: null, attemptId: null, type: 'setupComplete'}));
    assert.throws(() => validateEnvelope({...request, sessionId: null}));
});
test('recording manifests allow only owned WAV tracks and transfer bookkeeping', () => {
    const manifest = {recordingId: 'r-1', ...scope, track: 'microphone', filename: 'microphone.wav', source: 'browser-memory', contentType: 'audio/wav', byteLength: 48, sha256: 'a'.repeat(64), status: 'complete'};
    assert.deepEqual(validateManifest(manifest), manifest);
    for (const change of [{filename: '../microphone.wav'}, {byteLength: -1}, {sha256: 'no'}, {track: 'timing'}, {offset: 12}, {status: 'unknown'}]) {
        assert.throws(() => validateManifest({...manifest, ...change}));
    }
});
