// Implementation policies, not operator-configurable settings.
const MEDIA_POLICY = Object.freeze({
    internalPortRange: Object.freeze([40000, 49999]),
    playbackDrainMs: 250,
    startupTimeoutMs: 30000,
    stopTimeoutMs: 7000,
    jitterMs: 20,
    opusBitrate: 128000,
    rtpFrames: 128
});
const SESSION_POLICY = Object.freeze({ maxWaitingParticipants: 100 });
const RECORDING_POLICY = Object.freeze({ uploadTimeoutMs: 600000, chunkBytes: 1048576 });
const WORKER_EXIT_TIMEOUT_MS = 2000;

function workerRequestTimeoutMs(method, config) {
    return (method === "stop" ? 2 * config.stopTimeoutMs : 4 * config.startupTimeoutMs) + 1000;
}

const TRACKS_PER_PARTICIPANT = 2;
const PCM_BYTES_PER_SECOND = 48000 * 2; // Mono 48 kHz S16LE.
// Browser playback recording continues through both core-stop phases, the stop
// and dispose IPC deadlines, worker exit, and playback drain. Share deadlines
// with the adapter so reducing the public schema cannot truncate valid audio.
const SHUTDOWN_ALLOWANCE_SECONDS = Math.ceil((workerRequestTimeoutMs("stop", MEDIA_POLICY) + workerRequestTimeoutMs("dispose", MEDIA_POLICY) + WORKER_EXIT_TIMEOUT_MS + MEDIA_POLICY.playbackDrainMs) / 1000);
const WAV_OVERHEAD_BYTES = 4096;
const MAX_RECORDING_BYTES = 2147483647;
const MAX_CONDITION_SECONDS = Math.floor((MAX_RECORDING_BYTES / TRACKS_PER_PARTICIPANT - WAV_OVERHEAD_BYTES) / PCM_BYTES_PER_SECOND - SHUTDOWN_ALLOWANCE_SECONDS);

function recordingByteLimit(seconds) {
    return TRACKS_PER_PARTICIPANT * ((seconds + SHUTDOWN_ALLOWANCE_SECONDS) * PCM_BYTES_PER_SECOND + WAV_OVERHEAD_BYTES);
}

module.exports = { MEDIA_POLICY, SESSION_POLICY, RECORDING_POLICY, WORKER_EXIT_TIMEOUT_MS, MAX_CONDITION_SECONDS, workerRequestTimeoutMs, recordingByteLimit };
