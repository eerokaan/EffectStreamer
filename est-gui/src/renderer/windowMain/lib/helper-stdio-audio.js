import captureWorkletUrl from "@/audio-worklets/capture-processor.js?url&no-inline";
import playbackWorkletUrl from "@/audio-worklets/playback-processor.js?url&no-inline";

const mediaPortChannel = "effectstreamer:audio-media-port";
const pendingPorts = new Map();
const portWaiters = new Map();
let provisionalSession = null;
let activeSession = null;

function portKey(contextKey, direction) {
    return contextKey + ":" + direction;
}

window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.channel !== mediaPortChannel || !event.ports?.[0]) return;
    const key = portKey(event.data.contextKey, event.data.direction);
    const waiter = portWaiters.get(key);
    if (waiter) {
        portWaiters.delete(key);
        waiter.resolve(event.ports[0]);
    }
    else {
        pendingPorts.get(key)?.close();
        pendingPorts.set(key, event.ports[0]);
    }
});

function waitForMediaPort(contextKey, direction) {
    const key = portKey(contextKey, direction);
    const existing = pendingPorts.get(key);
    if (existing) {
        pendingPorts.delete(key);
        return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            portWaiters.delete(key);
            reject(new Error("Timed out waiting for the " + direction + " media port"));
        }, 10000);
        portWaiters.set(key, {
            resolve: (port) => {
                window.clearTimeout(timeout);
                resolve(port);
            },
            reject: (error) => {
                window.clearTimeout(timeout);
                reject(error);
            }
        });
    });
}

function cancelPendingMediaPorts(contextKey) {
    for (const direction of ["capture", "playback"]) {
        const key = portKey(contextKey, direction);
        pendingPorts.get(key)?.close();
        pendingPorts.delete(key);
        const waiter = portWaiters.get(key);
        if (waiter) {
            portWaiters.delete(key);
            waiter.reject(new Error("Audio startup was cancelled"));
        }
    }
}

function getCaptureConstraints(sourceId) {
    return {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(sourceId === "default" ? {} : { deviceId: { exact: sourceId } })
    };
}

function assertBrowserProcessingDisabled(track) {
    const settings = track.getSettings();
    for (const setting of ["echoCancellation", "noiseSuppression", "autoGainControl"]) {
        if (settings[setting] === true) throw new Error("The selected microphone reports active browser processing: " + setting);
    }
}

async function assignOutputDevice(context, sinkId) {
    if (sinkId === "default") return;
    if (typeof context.setSinkId !== "function") {
        throw new Error("This Electron build does not support selecting a concrete audio output; choose Default output");
    }
    await context.setSinkId(sinkId);
}

async function createAudioContext(sinkId) {
    const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    try {
        if (context.sampleRate !== 48000) throw new Error("The browser created an AudioContext at " + context.sampleRate + " Hz instead of 48000 Hz");
        await assignOutputDevice(context, sinkId);
        await context.resume();
        if (context.state !== "running") throw new Error("The AudioContext remained suspended");
        return context;
    }
    catch (error) {
        await context.close();
        throw error;
    }
}

async function enumerateAudioDevices() {
    let permissionStream;
    try {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const sources = [{ id: "default", label: "Default microphone" }];
        const sinks = [{ id: "default", label: "Default output" }];

        for (const device of devices) {
            if (device.deviceId === "default") continue;
            if (device.kind === "audioinput") {
                sources.push({ id: device.deviceId, label: device.label || "Microphone " + sources.length });
            }
            else if (device.kind === "audiooutput") {
                sinks.push({ id: device.deviceId, label: device.label || "Output " + sinks.length });
            }
        }
        return { sources, sinks };
    }
    finally {
        permissionStream?.getTracks().forEach((track) => track.stop());
    }
}

async function validateAudioDevices(sourceId, sinkId) {
    let stream;
    let context;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: getCaptureConstraints(sourceId), video: false });
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error("The selected microphone did not provide an audio track");
        assertBrowserProcessingDisabled(track);
        context = await createAudioContext(sinkId);
    }
    finally {
        stream?.getTracks().forEach((track) => track.stop());
        if (context && context.state !== "closed") await context.close();
    }
}

function reportFailure(component, session, message) {
    if ((activeSession !== session && provisionalSession !== session) || session.stopping) return;
    window.appApi.ipcRenderer.invoke("ipc:audioFailure", { component, contextKey: session.contextKey, message }).catch(() => {});
}

function monitorWorklet(node, component, session) {
    node.onprocessorerror = () => reportFailure(component, session, component + " AudioWorklet processor failed");
    node.port.onmessage = (event) => {
        if (event.data?.type === "failure") reportFailure(component, session, event.data.message);
    };
}

function assertSessionCurrent(session) {
    if (session.cancelled || session.stopping || (activeSession !== session && provisionalSession !== session)) {
        throw new Error("Audio startup was cancelled");
    }
}

function disconnectNode(node) {
    try {
        node?.disconnect();
    }
    catch {
        // Already disconnected during concurrent timeout cleanup.
    }
}

function postNodeMessage(node, message) {
    try {
        node?.port.postMessage(message);
    }
    catch {
        // The node may already be gone during timeout cleanup.
    }
}

function closeMediaPort(port) {
    try {
        port?.close();
    }
    catch {
        // The port may already have been transferred or closed.
    }
}

async function cleanupSession(session) {
    postNodeMessage(session.capture, { type: "shutdown" });
    postNodeMessage(session.playback, { type: "shutdown" });
    disconnectNode(session.source);
    disconnectNode(session.capture);
    disconnectNode(session.mutedOutput);
    disconnectNode(session.playback);
    closeMediaPort(session.mediaPort);
    closeMediaPort(session.playbackMediaPort);
    session.stream?.getTracks().forEach((track) => track.stop());
    if (session.context && session.context.state !== "closed") await session.context.close().catch(() => {});
}

async function startSender(payload) {
    if (activeSession || provisionalSession) throw new Error("An audio condition is already active in the renderer");
    const session = {
        contextKey: payload.contextKey,
        cancelled: false,
        stopping: false,
        context: null,
        stream: null,
        source: null,
        capture: null,
        mutedOutput: null,
        playback: null,
        mediaPort: null,
        playbackMediaPort: null
    };
    provisionalSession = session;

    try {
        session.mediaPort = await waitForMediaPort(payload.contextKey, "capture");
        assertSessionCurrent(session);
        session.stream = await navigator.mediaDevices.getUserMedia({ audio: getCaptureConstraints(payload.sourceId), video: false });
        assertSessionCurrent(session);
        const track = session.stream.getAudioTracks()[0];
        if (!track) throw new Error("The selected microphone did not provide an audio track");
        assertBrowserProcessingDisabled(track);
        session.context = await createAudioContext(payload.sinkId);
        assertSessionCurrent(session);
        await session.context.audioWorklet.addModule(captureWorkletUrl);
        assertSessionCurrent(session);

        session.source = session.context.createMediaStreamSource(session.stream);
        session.capture = new AudioWorkletNode(session.context, "effectstreamer-capture", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: "explicit"
        });
        session.mutedOutput = session.context.createGain();
        session.mutedOutput.gain.value = 0;

        track.addEventListener("ended", () => reportFailure("capture", session, "The selected microphone track ended"));
        session.context.addEventListener("statechange", () => {
            if (session.context.state !== "running") reportFailure("capture", session, "The AudioContext stopped running");
        });
        monitorWorklet(session.capture, "capture", session);
        assertSessionCurrent(session);

        session.source.connect(session.capture).connect(session.mutedOutput).connect(session.context.destination);
        session.capture.port.postMessage({ type: "attach", port: session.mediaPort }, [session.mediaPort]);
        session.mediaPort = null;
        activeSession = session;
        provisionalSession = null;

        return {
            sampleRate: session.context.sampleRate,
            baseLatency: Number.isFinite(session.context.baseLatency) ? session.context.baseLatency : null,
            outputLatency: Number.isFinite(session.context.outputLatency) ? session.context.outputLatency : null
        };
    }
    catch (error) {
        session.cancelled = true;
        await cleanupSession(session).catch(() => {});
        if (activeSession === session) activeSession = null;
        if (provisionalSession === session) provisionalSession = null;
        throw error;
    }
}

async function startReceiver(payload) {
    const session = activeSession;
    if (!session || session.contextKey !== payload.contextKey || session.stopping || session.receiverStarting) throw new Error("No matching renderer audio session");
    if (session.playback) throw new Error("Playback is already active");
    session.receiverStarting = true;

    try {
        session.playbackMediaPort = await waitForMediaPort(payload.contextKey, "playback");
        assertSessionCurrent(session);
        await session.context.resume();
        assertSessionCurrent(session);
        if (session.context.state !== "running") throw new Error("The AudioContext remained suspended before playback startup");
        await session.context.audioWorklet.addModule(playbackWorkletUrl);
        assertSessionCurrent(session);
        session.playback = new AudioWorkletNode(session.context, "effectstreamer-playback", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: "explicit"
        });
        monitorWorklet(session.playback, "playback", session);
        assertSessionCurrent(session);
        session.playback.connect(session.context.destination);
        session.playback.port.postMessage({ type: "attach", port: session.playbackMediaPort }, [session.playbackMediaPort]);
        session.playbackMediaPort = null;
        session.receiverStarting = false;
    }
    catch (error) {
        session.receiverStarting = false;
        disconnectNode(session.playback);
        closeMediaPort(session.playbackMediaPort);
        session.playbackMediaPort = null;
        throw error;
    }
}

async function stopCapture(payload) {
    const session = activeSession?.contextKey === payload.contextKey ? activeSession : provisionalSession?.contextKey === payload.contextKey ? provisionalSession : null;
    if (!session) {
        cancelPendingMediaPorts(payload.contextKey);
        return;
    }
    session.cancelled = true;
    session.stopping = true;
    cancelPendingMediaPorts(payload.contextKey);
    if (session === provisionalSession) {
        await cleanupSession(session);
        if (provisionalSession === session) provisionalSession = null;
        return;
    }
    postNodeMessage(session.capture, { type: "shutdown" });
    disconnectNode(session.source);
    disconnectNode(session.capture);
    disconnectNode(session.mutedOutput);
    session.stream?.getTracks().forEach((track) => track.stop());
}

async function stopCondition(payload) {
    const session = activeSession?.contextKey === payload.contextKey ? activeSession : provisionalSession?.contextKey === payload.contextKey ? provisionalSession : null;
    cancelPendingMediaPorts(payload.contextKey);
    if (!session) return;
    session.cancelled = true;
    session.stopping = true;
    try {
        await cleanupSession(session);
    }
    finally {
        if (activeSession === session) activeSession = null;
        if (provisionalSession === session) provisionalSession = null;
    }
}

async function handleControl(action, payload) {
    if (action === "start-sender") return startSender(payload);
    if (action === "start-receiver") return startReceiver(payload);
    if (action === "stop-capture") return stopCapture(payload);
    if (action === "stop-condition") return stopCondition(payload);
    throw new Error("Unsupported audio control action: " + action);
}

function initializeAudioSessionControl() {
    window.appApi.ipcRenderer.on("ipc:audioControlRequest", async (_, request) => {
        try {
            const result = await handleControl(request.action, request.payload);
            await window.appApi.ipcRenderer.invoke("ipc:audioControlResponse", { requestId: request.requestId, success: true, result });
        }
        catch (error) {
            await window.appApi.ipcRenderer.invoke("ipc:audioControlResponse", { requestId: request.requestId, success: false, error: error.message });
        }
    });
}

export { enumerateAudioDevices, initializeAudioSessionControl, validateAudioDevices };
