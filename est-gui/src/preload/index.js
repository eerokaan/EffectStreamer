import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import appInfo from "@/main/lib/appInfo";

// Define valid channels by operation type
const validChannels = {
    invoke: ["ipc:viewChangeRequest", "ipc:pretestSubmitRequest", "ipc:coreStartRequest", "ipc:coreStopRequest"],
    on: ["ipc:storeGetValueRequest", "ipc:storeSetValueRequest", "ipc:storeResetRequest"],
    send: ["ipc:storeGetValueResponse", "ipc:storeSetValueResponse", "ipc:storeResetResponse"]
};

// Create a secure wrapper for ipcRenderer
const appAPI = {
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

// Expose the APIs/data to the renderer process
contextBridge.exposeInMainWorld("electronApi", electronAPI);
contextBridge.exposeInMainWorld("appApi", appAPI);
contextBridge.exposeInMainWorld("appInfo", appInfo);
