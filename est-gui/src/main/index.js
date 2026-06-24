// ===========================================
// ===== COMMON ==============================
// ===========================================
import { spawn } from "child_process";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { io } from "socket.io-client";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import fs from "fs";
import path from "path";
import appContent from "@/main/lib/appContent";
import appContext from "@/main/lib/appContext";
import appInfo from "@/main/lib/appInfo";

const estConfig = JSON.parse(fs.readFileSync(helperResolveConfigPath(), "UTF-8"));

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
    appContext.windowMain.on("closed", async () => {
        await helperEstCoreKill();
        await helperEstCoreCleanup();
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
    const clientId = helperClientGetId();
    if (!clientId) return;

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
            clientId,
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
        if (data?.showDialog) {
            appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
                storeName: "Root",
                payload: { showDialog: true }
            });
            return;
        }

        appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
            storeName: "Root",
            payload: {
                currentView: data.currentView,
                showDialog: data.showDialog ?? false,
                pretestForm: data.pretestForm ?? null,
                conditionAsset: data.conditionAsset ?? null,
                conditionScaleOffset: data.conditionScaleOffset ?? null,
                conditionListeningSpeakingTestIndex: data.conditionListeningSpeakingTestIndex ?? null,
                conditionListeningSpeakingTestRole: data.conditionListeningSpeakingTestRole ?? null
            }
        });
        appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
            storeName: "ComponentFooter",
            payload: { isWaitingForPeer: false }
        });
        appContext.windowMain.webContents.send("ipc:storeResetRequest", {
            storeName: "ComponentScale"
        });
    });

    // coreStartResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:coreStartResponse", async (data) => {
        // Stage 1: Sender component
        if (data.component === "sender") {
            const args = [
                "--mode",
                data.component,
                ...(data.deviceSource ? ["--device", data.deviceSource] : []),
                "--peerip",
                data.peerIp,
                ...(data.nativeDelay != null ? ["--native-delay", data.nativeDelay] : []),
                ...(data.echoDelay != null ? ["--echo-delay", data.echoDelay] : []),
                ...(data.packetlossType != null ? ["--packetloss-type", data.packetlossType] : []),
                ...(data.packetlossRatio != null ? ["--packetloss-ratio", data.packetlossRatio] : []),
                ...(data.packetlossSeed != null ? ["--packetloss-seed", data.packetlossSeed] : []),
                ...(data.packetlossBurstModel != null ? ["--packetloss-burst-model", data.packetlossBurstModel] : []),
                ...(data.packetlossBurstRatio != null ? ["--packetloss-burst-ratio", data.packetlossBurstRatio] : [])
            ];

            await helperEstCoreSpawn(args, (childProcess) => {
                appContext.estCoreSender = childProcess;
            });
            appContext.socket.emit("est-event:coreStartRequest", {
                component: "receiver",
                testType: data.testType
            });
        }

        // Stage 2: Receiver component
        else if (data.component === "receiver") {
            const args = ["--mode", data.component, ...(data.deviceSink ? ["--device", data.deviceSink] : []), ...(data.nativeGain != null ? ["--native-gain", data.nativeGain] : []), ...(data.echoGain != null ? ["--echo-gain", data.echoGain] : [])];

            await helperEstCoreSpawn(args, (childProcess) => {
                appContext.estCoreReceiver = childProcess;
            });
        }
    });

    // coreStopResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:coreStopResponse", async (data) => {
        await helperEstCoreKill();

        // For cases where we simply want to close down (No file upload)
        if (data.upload === false) {
            await helperEstCoreCleanup();
            return;
        }

        // Read recording files created by est-core
        const homeDir = app.getPath("home");
        const effectstreamerDir = path.join(homeDir, "effectstreamer");

        const microphoneData = await fs.promises.readFile(path.join(effectstreamerDir, "microphone.ogg"));
        const headphonesData = await fs.promises.readFile(path.join(effectstreamerDir, "headphones.ogg"));

        // Adjust footer button
        appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
            storeName: "ComponentFooter",
            payload: { isWaitingForUpload: true }
        });

        // Send both files to the server
        appContext.socket.emit("est-event:fileTransferRequest", {
            fileName: "microphone.ogg",
            fileData: microphoneData,
            testType: data.testType
        });
        appContext.socket.emit("est-event:fileTransferRequest", {
            fileName: "headphones.ogg",
            fileData: headphonesData,
            testType: data.testType
        });
    });

    // pretestSubmitResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:pretestSubmitResponse", () => {
        // Form submitted
    });

    // fileTransferResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:fileTransferResponse", () => {
        appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
            storeName: "ComponentFooter",
            payload: { isWaitingForUpload: false }
        });
    });

    // ===== Outbound communication ==============================
    // viewChangeRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:viewChangeRequest", (_, ...args) => {
        appContext.socket.emit("est-event:viewChangeRequest", args[0]);
    });

    // coreStartRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:coreStartRequest", (_, ...args) => {
        appContext.socket.emit("est-event:coreStartRequest", args[0]);
    });

    // coreStopRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:coreStopRequest", (_, ...args) => {
        appContext.socket.emit("est-event:coreStopRequest", args[0]);
    });

    // pretestSubmitRequest
    // [RENDERER -> PRELOAD -> MAIN] -> [SERVER]
    ipcMain.handle("ipc:pretestSubmitRequest", (_, ...args) => {
        appContext.socket.emit("est-event:pretestSubmitRequest", args[0]);
    });
}

// ===========================================
// ===== HELPER ==============================
// ===========================================
function helperResolveConfigPath() {
    const configName = "est-config.json";

    if (process.env.APPIMAGE) {
        return path.join(path.dirname(process.env.APPIMAGE), configName);
    }
    else if (app.isPackaged) {
        return path.join(path.dirname(app.getPath("exe")), configName);
    }
    else {
        return path.join(app.getAppPath(), configName);
    }
}

function helperGetOperatingSystem() {
    let platform = process.platform;
    if (platform === "linux") return "linux";
    if (platform === "win32") return "windows";
    return null;
}

function helperClientGetId() {
    const clientId = estConfig.client.identity;

    if (typeof clientId !== "string" || clientId.trim().length === 0) {
        console.error("Missing or invalid client.identity in est-config.json");
        return null;
    }

    return clientId;
}

async function helperEstCoreSpawn(args = [], childProcessRegistry = () => {}) {
    const base = path.join(process.resourcesPath, "est-core");
    const platform = helperGetOperatingSystem();
    let childProcess, gstLib;

    if (platform === "linux") {
        gstLib = path.join(base, "gst-lib", "x86_64-linux-gnu", "lib");
        childProcess = spawn(path.join(base, "est-core"), args, {
            env: {
                ...process.env,
                LD_LIBRARY_PATH: gstLib + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : ""),
                GST_PLUGIN_PATH: path.join(gstLib, "gstreamer-1.0")
            }
        });
    }
    else if (platform === "windows") {
        gstLib = path.join(base, "gst-lib", "x86_64-windows", "lib");
        childProcess = spawn(path.join(base, "est-core.exe"), args, {
            env: {
                ...process.env,
                PATH: path.join(base, "gst-lib", "x86_64-windows", "bin") + ";" + process.env.PATH,
                GST_PLUGIN_PATH: path.join(gstLib, "gstreamer-1.0")
            }
        });
    }
    else {
        throw new Error("Unsupported platform: " + process.platform);
    }

    return new Promise((resolve, reject) => {
        function childProcessListenerCleanup() {
            childProcess.stdout.off("data", onReady);
            childProcess.off("error", onError);
            childProcess.off("close", onClose);
        }

        function onReady() {
            childProcessListenerCleanup();
            resolve(childProcess);
        }

        function onError(error) {
            childProcessListenerCleanup();
            childProcessRegistry(null);
            reject(error);
        }

        function onClose(code) {
            childProcessListenerCleanup();
            childProcessRegistry(null);
            reject(new Error("est-core exited prematurely with code " + code));
        }

        childProcess.stdout.once("data", onReady);
        childProcess.once("error", onError);
        childProcess.once("close", onClose);
        childProcessRegistry(childProcess);
    });
}

async function helperEstCoreKill() {
    const killPromises = [];

    if (appContext.estCoreSender) {
        killPromises.push(
            new Promise((resolve) => {
                appContext.estCoreSender.once("close", () => {
                    appContext.estCoreSender = null;
                    resolve();
                });
                appContext.estCoreSender.kill();
            })
        );
    }

    if (appContext.estCoreReceiver) {
        killPromises.push(
            new Promise((resolve) => {
                appContext.estCoreReceiver.once("close", () => {
                    appContext.estCoreReceiver = null;
                    resolve();
                });
                appContext.estCoreReceiver.kill();
            })
        );
    }

    await Promise.all(killPromises);
}

async function helperEstCoreCleanup() {
    try {
        const homeDir = app.getPath("home");
        const effectstreamerDir = path.join(homeDir, "effectstreamer");
        await fs.promises.rm(effectstreamerDir, { recursive: true, force: true });
    }
    catch (error) {
        console.error("Error cleaning up EffectStreamer directory:", error);
    }
}
