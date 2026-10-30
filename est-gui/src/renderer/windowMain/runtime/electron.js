import { createParticipantRuntime } from "./create-runtime.js";

export function createRuntime({ bridge = globalThis.window?.appApi?.runtime, transportFactory } = {}) {
    if (!bridge?.invoke) throw new Error("Native runtime bridge is unavailable");
    let initialized, stdio;
    const runtime = createParticipantRuntime({
        initialize: async () => {
            initialized = await bridge.invoke("bootstrap");
            if (initialized.config.audioBackend === "stdio") {
                stdio = await import("../lib/helper-stdio-audio.js");
                stdio.initializeAudioSessionControl();
            }
            return initialized;
        }, transportFactory,
        devices: {
            list: async () => {
                if (!stdio) return bridge.invoke("devices.list");
                const devices = await stdio.enumerateAudioDevices();
                return { inputs: devices.sources, outputs: devices.sinks, selection: { sourceId: initialized.config.selectedAudioDevices.source || "default", sinkId: initialized.config.selectedAudioDevices.sink || "default" } };
            },
            test: async selection => {
                if (!stdio) return bridge.invoke("devices.test", selection);
                await stdio.validateAudioDevices(selection.sourceId, selection.sinkId);
                const element = new Audio(new URL("./audio/" + initialized.config.testAsset.split("/").pop(), window.location.href).href);
                if (selection.sinkId !== "default") await element.setSinkId(selection.sinkId);
                const ended = new Promise((resolve, reject) => {element.onended = resolve;element.onerror = () => reject(new Error("P.501 playback failed"));});
                await element.play();await ended;
                return { inputUsable: true, playbackComplete: true };
            },
            save: selection => bridge.invoke("devices.save", selection)
        },
        media: {
            command: async (command, runtime) => {
                const result = await bridge.invoke("media.command", command);
                for (const message of Array.isArray(result) ? result : [result]) {
                    if (message?.type) await runtime.dispatch(message.type, message.payload, { scope: message.scope });
                }
            },
            dispose: () => bridge.invoke("media.dispose")
        },
        recordings: {
            collect: async (command, runtime) => {
                const result = await bridge.invoke("recordings.collect", command);
                return result;
            }
        }
    });
    const removeFailure = bridge.onFailure?.(failure => { void runtime.dispatch("mediaFailed", { message: failure.message }, { scope: failure.scope }).catch(error => runtime.onError?.(error)); });
    const dispose = runtime.dispose;
    runtime.dispose = async () => {removeFailure?.();await dispose();};
    return runtime;
}
