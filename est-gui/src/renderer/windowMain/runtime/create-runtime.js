import { io } from "socket.io-client";
import { createSessionClient } from "./session-client.js";

export function createParticipantRuntime({ initialize, devices = {}, media = {}, recordings = {}, transportFactory = io }) {
    const subscribers = new Set();
    let client, transport, bootstrapPromise, configuration, current;
    const runtime = {
        devices, media, recordings,
        config: () => configuration,
        snapshot: () => current,
        subscribe(listener) { subscribers.add(listener); if (current) listener(current); return () => subscribers.delete(listener); },
        bootstrap() {
            bootstrapPromise ||= (async () => {
                const { config, credentials, url } = await initialize();
                configuration = config;
                transport = transportFactory(url, { auth: { reconnectToken: credentials.reconnectToken }, transports: ["websocket", "polling"] });
                client = createSessionClient({ transport, participantId: credentials.participantId,
                    onSnapshot(snapshot) { current = snapshot; for (const listener of subscribers) listener(snapshot); },
                    onCommand: command => runtime.handleCommand(command), onError: error => runtime.onError?.(error)
                });
                return config;
            })();
            return bootstrapPromise;
        },
        dispatch(type, payload, options) {
            if (!client) return Promise.reject(new Error("Runtime is not initialized"));
            return client.dispatch(type, payload, options);
        },
        async handleCommand(command) {
            if (command.participantId && command.participantId !== current?.participantId) throw new Error("Media command belongs to another participant");
            if (command.type === "collectRecordings") {
                if (!recordings.collect) throw new Error("Recording collection is unavailable");
                return recordings.collect(command, runtime);
            }
            if (media.command) return media.command(command, runtime);
        },
        async dispose() { client?.dispose(); transport?.disconnect(); await media.dispose?.(); subscribers.clear(); }
    };
    return runtime;
}
