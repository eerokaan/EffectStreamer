import { createParticipantRuntime } from "./create-runtime.js";
import { BrowserDevices } from "../audio/browser-devices.js";
import { BrowserAudioSession } from "../audio/browser-session.js";
import { BrowserRecordings } from "../audio/browser-recordings.js";

async function initializeBrowser() {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Unable to load study configuration");
    const config = await response.json();
    const query = Object.fromEntries(new URLSearchParams(location.search));
    const key = "effectstreamer:" + (query.SESSION_ID || query.identity || "participant");
    let credentials;
    try { credentials = JSON.parse(sessionStorage.getItem(key)); } catch { /* Ignore invalid local state. */ }
    if (!credentials) {
        const admitted = await fetch("/api/enrollment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity: query.identity, query }) });
        if (!admitted.ok) throw new Error((await admitted.json()).error || "Study admission failed");
        credentials = await admitted.json(); sessionStorage.setItem(key, JSON.stringify(credentials));
    }
    return { config, credentials, url: location.origin };
}
export function createRuntime({ initialize = initializeBrowser, transportFactory, devices, media, recordings } = {}) {
    const browserDevices = devices || new BrowserDevices();
    let runtime, session, scope, generation, initialized;
    const failure = error => {
        runtime.onError?.(error);
        if (scope) void runtime.dispatch("mediaFailed", { message: error.message, generation }, { scope }).catch(error => runtime.onError?.(error));
    };
    const browserRecordings = recordings || new BrowserRecordings({ devices: browserDevices, getConfiguration: () => initialized, onFailure: failure });
    const browserMedia = media || {
        async command(command) {
            if (command.type === "remoteSignal") return session?.applySignal(command.signal);
            if (command.type === "disconnected") {
                await session?.stopCapture();
                if (scope) await browserRecordings.finalize?.({ scope, status: "interrupted" });
                await session?.stop();return;
            }
            if (command.type === "prepareRemote") {
                scope = { sessionId: command.sessionId, participantId: command.participantId, attemptId: command.attemptId };generation = command.generation;
                session = new BrowserAudioSession({ devices: browserDevices, onFailure: failure });
                try {
                    await session.prepare({ scope, generation, iceServers: command.iceServers, signal: payload => runtime.dispatch("signal", payload, { scope }) });
                    await runtime.dispatch("mediaPrepared", { component: "remote", success: true, generation }, { scope });
                }
                catch (error) {failure(error);}
                return;
            }
            if (!scope || command.attemptId !== scope.attemptId || command.generation !== generation) throw new Error("Stale browser media command");
            try {
                if (command.type === "startAudio") {
                    await browserRecordings.start(session.streams(), { scope });await session.start();
                    return runtime.dispatch("mediaStarted", { success: true, generation }, { scope });
                }
                if (command.type === "stopCapture") return session.stopCapture();
                if (command.type === "stopCore") {
                    const manifests = await browserRecordings.finalize({ scope, status: command.reason === "completed" ? "complete" : "interrupted" });
                    await session.stop();
                    await runtime.dispatch("mediaStopped", { success: true, generation }, { scope });
                    if (manifests) await runtime.dispatch("recordingsFinalized", { manifests }, { scope });
                    return;
                }
                throw new Error("Unknown browser media command");
            }
            catch (error) {failure(error);}
        },
        async dispose() {await browserRecordings.dispose?.();await session?.stop();await browserDevices.dispose?.();}
    };
    runtime = createParticipantRuntime({ initialize: async () => {initialized = await initialize();browserDevices.testAsset = initialized.config.testAsset;return initialized;}, transportFactory, devices: browserDevices, media: browserMedia, recordings: browserRecordings });
    browserDevices.onInvalidated = () => {if (session?.generation) failure(new Error("Audio devices changed; repeat device setup before retrying"));};
    return runtime;
}
