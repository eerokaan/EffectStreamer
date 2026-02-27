// ===========================================
// ===== COMMON ==============================
// ===========================================
import path from "path";

import { appInfo } from "./appInfo";
import { app, shell, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";

import { default as appContent } from "./lib/appContent";
import { default as initZustandStorage } from "./lib/zustandStorage";

import appContext from "./lib/appContext";
import zustandStores from "./lib/zustandStores";

// ===========================================
// ===== WINDOW HANDLING =====================
// ===========================================
app.whenReady()
    .then(() => {
        electronApp.setAppUserModelId(appInfo.name);

        app.on("browser-window-created", (_, window) => {
            optimizer.watchWindowShortcuts(window);
        });

        // For macOS
        app.on("activate", function () {
            if (BrowserWindow.getAllWindows().length === 0) {
                initCreateWindow();
            }
        });
    })
    .then(() => {
        initCreateWindow();
        initZustandStorage();
    });

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

async function initCreateWindow() {
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

    // Closing events for windows
    appContext.windowMain.on("closed", () => {
        app.emit("window-all-closed");
    });
    appContext.windowMain.on("close", async (event) => {
        event.preventDefault();
        const { setStoreValue } = zustandStores(appContext.windowMain);

        //await setStoreValue("DummyStore01", "resetStates", {});
        //await setStoreValue("DummyStore02", "resetStates", {});

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
    appContent(appContext.windowMain, "windowMain.html");
}
