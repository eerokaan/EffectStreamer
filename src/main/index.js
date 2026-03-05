// ===========================================
// ===== COMMON ==============================
// ===========================================
import estConfig from "../../est-config.js";
import path from "path";

import { app, shell, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { io } from "socket.io-client";

import appContent from "./lib/appContent";
import appContext from "./lib/appContext";
import appInfo from "./lib/appInfo";

// ===========================================
// ===== WINDOW HANDLING =====================
// ===========================================
(async () => {
    await app.whenReady();

    electronApp.setAppUserModelId(appInfo.name);
    
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });
    
    await initWindow();
    await initSocket();
})();

// ===========================================
// ===== WINDOW HANDLING =====================
// ===========================================
async function initWindow() {

    // ===== Common ==============================
    // Window creation
    appContext.windowMain = new BrowserWindow({
        x: 100,
        y: 100,
        width: 1366,
        height: 768,
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
    appContext.windowMain.on("close", async (event) => {
        event.preventDefault();

        appContext.socket.disconnect();
        appContext.windowMain.destroy();
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
// ===== SOCKET HANDLING =====================
// ===========================================
async function initSocket() {

    // Setup socket client
    const serverUrl = `http://${estConfig.server.host}:${estConfig.server.port}`;
    appContext.socket = io(serverUrl, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });
    
    // Connection established
    appContext.socket.on("connect", () => {

        // Handle registration
        appContext.socket.emit("est-event:register", {
            appName: appInfo.displayName,
            appVersion: appInfo.version,
            platform: process.platform
        });

        // Handle est-event:allClientsConnected command from server
        appContext.socket.on("est-event:allClientsConnected", (data) => {
            appContext.windowMain.webContents.send("ipc:allClientsConnected", data);
        });

        // Handle disconnection
        appContext.socket.on("disconnect", (reason) => {
            console.log("Disconnected from server:", reason);
        });
    });
}