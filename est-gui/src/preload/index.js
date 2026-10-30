import { contextBridge, ipcRenderer } from "electron";
import appInfo from "@/main/lib/appInfo";

// BITTE ANGLEICHEN AN GG-APPLICATION --> NEUE VERSION DES PRELOADS VORHANDEN

// Define valid channels by operation type
const validChannels = {
    invoke: ["ipc:viewChangeRequest", "ipc:pretestSaveRequest", "ipc:audioDevicesGet", "ipc:audioDevicesSave", "ipc:audioDevicesSetupComplete", "ipc:audioControlResponse", "ipc:audioFailure"],
    on: ["ipc:storeGetValueRequest", "ipc:storeSetValueRequest", "ipc:storeResetRequest", "ipc:audioDevicesOpen", "ipc:audioControlRequest"],
    send: ["ipc:storeGetValueResponse", "ipc:storeSetValueResponse", "ipc:storeResetResponse"]
};

const mediaPortChannel = "effectstreamer:audio-media-port";

// Create a secure wrapper for ipcRenderer
const appApi = {
    runtime: {
        onFailure: (listener) => {
            const handler = (_event, data) => listener(data);
            ipcRenderer.on("ipc:runtimeFailure", handler);
            return () => ipcRenderer.removeListener("ipc:runtimeFailure", handler);
        },
        invoke: (operation, payload) => {
            const allowed = ["bootstrap", "devices.list", "devices.test", "devices.save", "media.command", "media.dispose", "recordings.collect"];
            if (!allowed.includes(operation)) throw new Error("Unauthorized runtime operation");
            return ipcRenderer.invoke("ipc:runtime", { operation, payload });
        }
    },
    ipcRenderer: {
        invoke: (channel, ...args) => {
            if (validChannels.invoke.includes(channel)) {
                return ipcRenderer.invoke(channel, ...args);
            }
            throw new Error("[ErrorGeneral] Unauthorized IPC channel: " + channel);
        },
        on: (channel, listener) => {
            if (validChannels.on.includes(channel)) {
                ipcRenderer.on(channel, listener);

                return () => {
                    ipcRenderer.removeListener(channel, listener);
                };
            }
            throw new Error("[ErrorGeneral] Unauthorized IPC channel: " + channel);
        },
        send: (channel, ...args) => {
            if (validChannels.send.includes(channel)) {
                ipcRenderer.send(channel, ...args);
            }
            else {
                throw new Error("[ErrorGeneral] Unauthorized IPC channel: " + channel);
            }
        }
    }
};

ipcRenderer.on("ipc:audioMediaPort", (event, metadata) => {
    const port = event.ports[0];
    if (!port || typeof metadata?.contextKey !== "string" || (metadata.direction !== "capture" && metadata.direction !== "playback")) {
        port?.close();
        return;
    }
    window.postMessage({ channel: mediaPortChannel, contextKey: metadata.contextKey, direction: metadata.direction }, "*", [port]);
});

// Expose the APIs/data to the renderer process
contextBridge.exposeInMainWorld("appApi", appApi);
contextBridge.exposeInMainWorld("appInfo", appInfo);
