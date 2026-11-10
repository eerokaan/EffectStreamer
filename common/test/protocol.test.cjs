const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvelope, validateManifest } = require('../protocol.cjs');
const { normalizeAudioConfig, serverUrl } = require('../client-config.cjs');

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
test('native defaults cannot inherit saved browser IDs', () => {
    assert.deepEqual(normalizeAudioConfig({client:{audioDevices:{source:'chromium-id',sink:'other'}}}), {backend:'native',devices:{source:'default',sink:'default'},recordingDir:null});
    assert.equal(normalizeAudioConfig({audio:{backend:'stdio'},client:{audioDevices:{source:'browser'}}}).devices.source, 'browser');
    assert.equal(normalizeAudioConfig({audio:{backend:'native',devices:{source:'hw:0,1',sink:'default'}}}).devices.source, 'hw:0,1');
    assert.throws(() => normalizeAudioConfig({audio:{backend:'webrtc'}}));
});
test('server URLs accept HTTPS or legacy IP/port but reject URL credentials and other protocols', () => {
    assert.equal(serverUrl({url:'https://study.example/'}), 'https://study.example');
    assert.equal(serverUrl({ipAddress:'::1',port:3000}), 'http://[::1]:3000');
    for (const url of ['file:///etc/passwd','https://user:secret@study.example/','https://study.example/path','http://study.example/#bad']) assert.throws(() => serverUrl({url}));
});
