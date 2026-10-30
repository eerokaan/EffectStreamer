// ===========================================
// ===== COMMON ==============================
// ===========================================
import { spawn } from "child_process";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { io } from "socket.io-client";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import fs from "fs";
import path from "path";
import appContent from "@/main/lib/appContent";
import appContext from "@/main/lib/appContext";
import appInfo from "@/main/lib/appInfo";

const estConfig = JSON.parse(fs.readFileSync(helperResolveConfigPath(), "UTF-8"));
const estCoreStopping = new WeakSet();
const estCoreStopPromises = new WeakMap();
let estCoreFailureReported = false;

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
            payload: { isWaitingForPeer: false, isWaitingForUpload: false }
        });
        appContext.windowMain.webContents.send("ipc:storeResetRequest", {
            storeName: "ComponentScale"
        });
    });

    // coreStartResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:coreStartResponse", async (data) => {
        if (estCoreFailureReported) return;

        try {
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

                const sender = await helperEstCoreSpawn(args, helperEstCoreRegistry("estCoreSender"));
                if (estCoreFailureReported || estCoreStopping.has(sender) || appContext.estCoreSender !== sender) return;

                appContext.socket.emit("est-event:coreStartRequest", {
                    component: "receiver",
                    testType: data.testType
                });
            }

            // Stage 2: Receiver component
            else if (data.component === "receiver") {
                const args = ["--mode", data.component, ...(data.deviceSink ? ["--device", data.deviceSink] : []), ...(data.nativeGain != null ? ["--native-gain", data.nativeGain] : []), ...(data.echoGain != null ? ["--echo-gain", data.echoGain] : [])];

                await helperEstCoreSpawn(args, helperEstCoreRegistry("estCoreReceiver"));
            }
        }
        catch (error) {
            if (error.name !== "AbortError") await helperEstCoreReportFailure(error);
        }
    });

    // coreStopResponse
    // [SERVER] -> [MAIN]
    appContext.socket.on("est-event:coreStopResponse", async (data) => {
        try {
            await helperEstCoreKill();

            // For cases where we simply want to close down (No file upload)
            if (data.upload === false) {
                await helperEstCoreCleanup();
                appContext.windowMain.webContents.send("ipc:storeSetValueRequest", {
                    storeName: "ComponentFooter",
                    payload: { isWaitingForUpload: false }
                });
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
        }
        catch (error) {
            await helperEstCoreReportFailure(error);
        }
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
    const mode = args[args.indexOf("--mode") + 1];
    if (mode !== "sender" && mode !== "receiver") throw new Error("Invalid est-core mode: " + mode);

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
        const readyMessage = (mode === "sender" ? "Sender" : "Receiver") + " running. Press Ctrl+C to stop.";
        let output = "";
        let diagnostics = "";
        let settled = false;
        let ready = false;
        const startupTimer = setTimeout(() => {
            finishStartup(coreError("startup timed out after 30 seconds"));
            void helperEstCoreStop(childProcess);
        }, 30000);

        function coreError(message) {
            return new Error("est-core " + mode + " " + message + (diagnostics ? "\n" + diagnostics.trim() : ""));
        }

        function finishStartup(error) {
            if (settled) return;
            settled = true;
            clearTimeout(startupTimer);
            if (error) reject(error);
            else resolve(childProcess);
        }

        function onStdout(chunk) {
            output += chunk.toString();
            const lines = output.split(/\r?\n/);
            output = lines.pop().slice(-8192);
            if (!settled && lines.some((line) => line.trim() === readyMessage)) {
                ready = true;
                finishStartup();
            }
        }

        function onStderr(chunk) {
            diagnostics = (diagnostics + chunk.toString()).slice(-8192);
            console.error("[est-core " + mode + "] " + chunk.toString().trimEnd());
        }

        function cancellationError() {
            const error = coreError("startup cancelled");
            error.name = "AbortError";
            return error;
        }

        function onError(error) {
            const stopping = estCoreStopping.has(childProcess);
            const failure = stopping ? cancellationError() : coreError(error.message);
            if (!settled) finishStartup(failure);
            else if (ready && !stopping) void helperEstCoreReportFailure(failure);
            // An error event need not terminate the child; keep it registered until close.
            if (!stopping) void helperEstCoreStop(childProcess);
        }

        function onClose(code, signal) {
            clearTimeout(startupTimer);
            childProcess.stdout.off("data", onStdout);
            childProcess.stderr.off("data", onStderr);
            childProcess.off("error", onError);
            childProcessRegistry(null);
            const failure = estCoreStopping.has(childProcess) ? cancellationError() : coreError("exited with " + (signal ? "signal " + signal : "code " + code));
            if (!settled) finishStartup(failure);
            else if (ready && !estCoreStopping.has(childProcess)) void helperEstCoreReportFailure(failure);
        }

        childProcess.stdout.on("data", onStdout);
        childProcess.stderr.on("data", onStderr);
        childProcess.on("error", onError);
        childProcess.once("close", onClose);
        childProcessRegistry(childProcess);
    });
}

function helperEstCoreRegistry(key) {
    let registeredChild = null;
    return (childProcess) => {
        if (childProcess) {
            registeredChild = childProcess;
            appContext[key] = childProcess;
        }
        else if (appContext[key] === registeredChild) {
            appContext[key] = null;
        }
    };
}

function helperEstCoreStop(childProcess) {
    if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null || !childProcess.pid) return Promise.resolve();
    if (estCoreStopPromises.has(childProcess)) return estCoreStopPromises.get(childProcess);

    estCoreStopping.add(childProcess);
    const stopPromise = new Promise((resolve) => {
        const onClose = () => {
            clearTimeout(stopTimer);
            childProcess.off("close", onClose);
            resolve();
        };
        const stopTimer = setTimeout(() => {
            console.error("est-core did not stop within five seconds; forcing termination");
            childProcess.kill("SIGKILL");
            onClose();
        }, 5000);
        childProcess.once("close", onClose);
        childProcess.kill();
    });
    estCoreStopPromises.set(childProcess, stopPromise);
    return stopPromise;
}

async function helperEstCoreKill() {
    await Promise.all(
        ["estCoreSender", "estCoreReceiver"].map(async (key) => {
            const childProcess = appContext[key];
            await helperEstCoreStop(childProcess);
            if (appContext[key] === childProcess) appContext[key] = null;
        })
    );
}

async function helperEstCoreReportFailure(error) {
    if (estCoreFailureReported) return;
    estCoreFailureReported = true;
    console.error("EffectStreamer audio failed:", error);

    // Unregistering ends the current server session and stops the peer's cores too.
    appContext.socket?.emit("est-event:clientUnregister");
    appContext.socket?.disconnect();
    await helperEstCoreKill();
    dialog.showErrorBox("EffectStreamer audio failed", error.message + "\n\nCheck the audio-device configuration and restart EffectStreamer on both clients.");
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
