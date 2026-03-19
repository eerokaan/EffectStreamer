// ===========================================
// ===== COMMON ==============================
// ===========================================
import estConfig from "../../est-config.js";
import path from "path";

import { app, shell, ipcMain, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { io } from "socket.io-client";

import appContent from "./lib/appContent";
import appContext from "./lib/appContext";
import appInfo from "./lib/appInfo";

// ===========================================
// ===== STARTUP / INITS =====================
// ===========================================
(async () => {
    await app.whenReady();
    electronApp.setAppUserModelId(appInfo.name);
    
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });
    
    await windowLogic();
    await socketLogic();
})();

// ===========================================
// ===== WINDOW LOGIC ========================
// ===========================================
async function windowLogic() {

    // ===== Common ==============================
    // Window creation
    appContext.windowMain = new BrowserWindow({
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        title: appInfo.displayName,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            preload: path.join(__dirname, "../preload/index.js")
        }
    });

    // Window closing
    appContext.windowMain.on("closed", () => {
        appContext.socket.disconnect();
    });

    // ===== windowMain ==============================
    // Deny popups
    appContext.windowMain.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    // Render content
    appContext.windowMain.on("ready-to-show", () => {
        appContext.windowMain.show();
    });

    // Load in content
    await appContent(appContext.windowMain, "windowMain.html");
}

// ===========================================
// ===== WEBSOCKET LOGIC =====================
// ===========================================
async function socketLogic() {

    // ===== Common ==============================
    // Setup socket connection
    const serverUrl = "http://" + estConfig.server.ipAddress + ":" + estConfig.server.port;
    appContext.socket = io(serverUrl, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });

    // clientRegister
    // [MAIN] -> [SERVER]
    appContext.socket.on("connect", () => {
        appContext.socket.emit("est-event:clientRegister", {
            operatingSystem: helperGetOperatingSystem(),
            ipAddress: estConfig.client.ipAddress,
            deviceSource: estConfig.client.audioDevices.source,
            deviceSink: estConfig.client.audioDevices.sink
        });
    });

    // clientUnregister
    // [MAIN] -> [SERVER]
    appContext.windowMain.on("close", () => {
        appContext.socket.emit("est-event:clientUnregister");
    });

    // ===== Inbound communication ==============================
    // viewChangeResponse
    // [SERVER] -> [MAIN -> PRELOAD -> RENDERER]
    appContext.socket.on("est-event:viewChangeResponse", (data) => {
        appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
            storeName: "Root",
            payload: { currentView: data }
        });
        appContext.windowMain.webContents.send("ipc:storeResetRequest", {
            storeName: "ComponentFooter"
        });
    });

    // coreStartResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:coreStartResponse", (data) => {

    });

    // coreStopResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:coreStopResponse", (data) => {

    });

    // ===== Outbound communication ==============================
    // viewChangeRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:viewChangeRequest", (_, ...args) => {
        appContext.socket.emit("est-event:viewChangeRequest", args[0]);
    });

    // coreStartRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:coreStartRequest", () => {
        appContext.socket.emit("est-event:coreStartRequest");
    });

    // coreStopRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:coreStopRequest", () => {
        appContext.socket.emit("est-event:coreStopRequest");
    });
}

// ===========================================
// ===== HELPER ==============================
// ===========================================
function helperGetOperatingSystem() {
    let platform = process.platform;
    if (platform === "linux") return "linux";
    if (platform === "win32") return "windows";
    return null;
}