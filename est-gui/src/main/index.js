import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { io } from "socket.io-client";
import { getAudioDeviceIds, getGuiConfigPath, readGuiConfig, saveAudioDeviceIds } from "@/main/lib/config";
import { getOperatingSystem, markCoreStarted, spawnCore } from "@/main/lib/coreProcess";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import fs from "fs";
import path from "path";
import appContent from "@/main/lib/appContent";
import appContext from "@/main/lib/appContext";
import appInfo from "@/main/lib/appInfo";
import AudioTransport from "@/main/lib/audioTransport";

const recordingFiles = ["microphone.ogg", "headphones.ogg", "audio-transport.json"];
const rendererControlRequests = new Map();
let rendererControlSequence = 0;
let fatalDisconnectPromise = null;
let resolveAudioSetup;
const audioSetupPromise = new Promise((resolve) => {
    resolveAudioSetup = resolve;
});

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

(async () => {
    await app.whenReady();
    electronApp.setAppUserModelId(appInfo.name);
    appContext.configPath = getGuiConfigPath();

    try {
        appContext.config = await readGuiConfig(appContext.configPath);
    }
    catch (error) {
        console.error(error.message);
        dialog.showErrorBox("EffectStreamer configuration error", error.message + "\n\nExpected path: " + appContext.configPath);
        app.quit();
        return;
    }

    registerIpcHandlers();
    await createMainWindow();
    appContext.audioTransport = new AudioTransport({
        window: appContext.windowMain,
        diagnosticsDirectory: path.dirname(appContext.configPath),
        requestRendererControl,
        onFatal: (error) => void fatalDisconnect(error)
    });

    await audioSetupPromise;
    if (!appContext.isClosing) await socketLogic();
})().catch((error) => {
    console.error("Fatal GUI startup error:", error);
    dialog.showErrorBox("EffectStreamer startup error", error.message);
    app.quit();
});

app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
});

app.on("window-all-closed", () => {
    app.quit();
});

function assertMainFrame(event) {
    if (!appContext.windowMain || event.sender !== appContext.windowMain.webContents || event.senderFrame !== appContext.windowMain.webContents.mainFrame) {
        throw new Error("Audio settings IPC is only available to the main application frame");
    }
}

function validateDeviceMetadata(value, name) {
    if (!value || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 1024 || typeof value.label !== "string" || value.label.length === 0 || value.label.length > 1024) {
        throw new Error("Invalid " + name + " device metadata");
    }
    return { id: value.id, label: value.label };
}

function registerIpcHandlers() {
    ipcMain.handle("ipc:audioDevicesGet", (event) => {
        assertMainFrame(event);
        return { ...getAudioDeviceIds(appContext.config), active: appContext.audioTransport?.isActive() || false };
    });

    ipcMain.handle("ipc:audioDevicesSave", async (event, deviceIds) => {
        assertMainFrame(event);
        if (appContext.audioTransport?.isActive()) throw new Error("Audio devices cannot be changed while a condition is active");
        appContext.config = await saveAudioDeviceIds(appContext.configPath, deviceIds);
        appContext.audioDevices = null;
        return getAudioDeviceIds(appContext.config);
    });

    ipcMain.handle("ipc:audioDevicesSetupComplete", (event, devices) => {
        assertMainFrame(event);
        const source = validateDeviceMetadata(devices?.source, "source");
        const sink = validateDeviceMetadata(devices?.sink, "sink");
        const configured = getAudioDeviceIds(appContext.config);
        if (source.id !== configured.source || sink.id !== configured.sink) throw new Error("Validated devices do not match config-gui.json");
        appContext.audioDevices = { source, sink };
        resolveAudioSetup(appContext.audioDevices);
        return true;
    });

    ipcMain.handle("ipc:audioControlResponse", (event, response) => {
        assertMainFrame(event);
        const pending = rendererControlRequests.get(response?.requestId);
        if (!pending) return false;
        rendererControlRequests.delete(response.requestId);
        clearTimeout(pending.timeout);
        if (response.success) pending.resolve(response.result);
        else pending.reject(new Error(response.error || "Renderer audio control failed"));
        return true;
    });

    ipcMain.handle("ipc:audioFailure", (event, data) => {
        assertMainFrame(event);
        appContext.audioTransport?.handleRendererFailure(data);
        return true;
    });

    ipcMain.handle("ipc:viewChangeRequest", (_, data) => {
        appContext.socket?.emit("est-event:viewChangeRequest", data);
    });

    ipcMain.handle("ipc:pretestSaveRequest", (_, data) => {
        appContext.socket?.emit("est-event:pretestSaveRequest", data);
    });
}

function requestRendererControl(action, payload, deadline = null) {
    if (!appContext.windowMain || appContext.windowMain.isDestroyed()) return Promise.reject(new Error("The renderer window is unavailable"));
    const requestId = ++rendererControlSequence;
    const timeoutMs = deadline == null ? 10000 : Math.max(1, deadline - Date.now());

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            rendererControlRequests.delete(requestId);
            reject(new Error("Timed out waiting for renderer audio control: " + action));
        }, timeoutMs);
        rendererControlRequests.set(requestId, { resolve, reject, timeout });
        appContext.windowMain.webContents.send("ipc:audioControlRequest", { requestId, action, payload });
    });
}

function isMainFramePermissionRequest(webContents, details = {}) {
    if (!appContext.windowMain || webContents !== appContext.windowMain.webContents || details.isMainFrame === false) return false;
    const requestingUrl = details.requestingUrl || details.requestingURL;
    return !requestingUrl || requestingUrl === webContents.mainFrame.url;
}

function isAudioPermission(permission, details = {}) {
    if (permission === "speaker-selection") return true;
    if (permission !== "media") return false;
    const mediaTypes = details.mediaTypes || (details.mediaType ? [details.mediaType] : []);
    return mediaTypes.length > 0 && mediaTypes.every((type) => String(type).toLowerCase().startsWith("audio"));
}

function configureMediaPermissions(window) {
    const applicationSession = window.webContents.session;
    applicationSession.setPermissionCheckHandler((webContents, permission, _origin, details) => isMainFramePermissionRequest(webContents, details) && isAudioPermission(permission, details));
    applicationSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        callback(isMainFramePermissionRequest(webContents, details) && isAudioPermission(permission, details));
    });
}

async function createMainWindow() {
    appContext.windowMain = new BrowserWindow({
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        title: appInfo.displayName,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: !app.isPackaged,
            preload: path.join(__dirname, "../preload/index.js")
        }
    });

    configureMediaPermissions(appContext.windowMain);
    appContext.windowMain.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });
    appContext.windowMain.webContents.on("before-input-event", (event, input) => {
        const commandKey = process.platform === "darwin" ? input.meta : input.control;
        if (input.type === "keyDown" && !input.isAutoRepeat && commandKey && input.alt && input.key.toLowerCase() === "o") {
            event.preventDefault();
            appContext.windowMain.webContents.send("ipc:audioDevicesOpen");
        }
    });
    appContext.windowMain.once("ready-to-show", () => appContext.windowMain.show());
    appContext.windowMain.on("close", (event) => {
        if (appContext.isClosing) return;
        event.preventDefault();
        appContext.isClosing = true;
        void closeApplication();
    });
    await appContent(appContext.windowMain, "windowMain.html");
}

async function closeApplication() {
    try {
        appContext.socket?.emit("est-event:clientUnregister");
    }
    catch (error) {
        console.error("Error unregistering EffectStreamer:", error);
    }
    try {
        await appContext.audioTransport?.stop({ writeDiagnostics: true });
    }
    catch (error) {
        console.error("Error stopping EffectStreamer during close:", error);
    }
    finally {
        appContext.socket?.disconnect();
        await cleanupRecordingFiles();
        if (appContext.windowMain && !appContext.windowMain.isDestroyed()) appContext.windowMain.destroy();
    }
}

async function fatalDisconnect(error) {
    if (fatalDisconnectPromise) return fatalDisconnectPromise;
    console.error("Fatal audio condition failure:", error);
    appContext.estCoreContextKey = null;
    if (appContext.socket) {
        appContext.socket.io.reconnection(false);
        appContext.socket.disconnect();
    }
    fatalDisconnectPromise = (async () => {
        try {
            await appContext.audioTransport?.stop({ writeDiagnostics: false });
        }
        catch (stopError) {
            console.error("Error cleaning up fatal audio condition:", stopError);
        }
    })();
    return fatalDisconnectPromise;
}

async function socketLogic() {
    const config = appContext.config;
    const clientId = config.client.identity;
    const serverUrl = "http://" + config.server.ipAddress + ":" + config.server.port;
    appContext.socket = io(serverUrl, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });

    appContext.socket.on("connect", () => {
        appContext.socket.emit("est-event:clientRegister", {
            clientId,
            operatingSystem: getOperatingSystem(),
            ipAddress: config.client.ipAddress
        });
    });

    appContext.socket.on("est-event:viewChangeResponse", handleViewChangeResponse);
    appContext.socket.on("est-event:recordingStateUpdateRequest", handleRecordingStateUpdate);
    appContext.socket.on("est-event:coreStartRequest", handleCoreStartRequest);
    appContext.socket.on("est-event:coreStopRequest", handleCoreStopRequest);
    appContext.socket.on("est-event:pretestSaveResponse", () => {});
    appContext.socket.on("est-event:fileTransferResponse", async (data) => {
        if (data.contextKey && appContext.estCoreContextKey && data.contextKey !== appContext.estCoreContextKey) return;
        appContext.estCoreContextKey = null;
        await cleanupRecordingFiles();
        setFooterState({ isWaitingForUpload: false, isWaitingForRecording: false });
    });
}

function handleViewChangeResponse(data) {
    if (data.showDialog) {
        setStoreState("Root", { showDialog: true });
        return;
    }
    setStoreState("Root", {
        currentView: data.currentView,
        showDialog: data.showDialog ?? false,
        pretestForm: data.pretestForm ?? null,
        conditionAsset: data.conditionAsset ?? null,
        conditionScaleOffset: data.conditionScaleOffset ?? null,
        conditionListeningSpeakingTestIndex: data.conditionListeningSpeakingTestIndex ?? null,
        conditionListeningSpeakingTestRole: data.conditionListeningSpeakingTestRole ?? null
    });
    const isRecordingView = data.currentView === "viewShortConversationTestMain" || data.currentView === "viewListeningSpeakingTestMain";
    setFooterState({
        isWaitingForPeer: false,
        isWaitingForUpload: false,
        ...(!isRecordingView || !appContext.estCoreContextKey ? { isWaitingForRecording: false } : {})
    });
    appContext.windowMain.webContents.send("ipc:storeResetRequest", { storeName: "ComponentScale" });
}

function handleRecordingStateUpdate(data) {
    if (data.contextKey && appContext.estCoreContextKey && data.contextKey !== appContext.estCoreContextKey) {
        appContext.socket.emit("est-event:recordingStateUpdateResponse", { contextKey: data.contextKey, status: data.status, ignored: true });
        return;
    }
    appContext.socket.emit("est-event:recordingStateUpdateResponse", { contextKey: data.contextKey, status: data.status, ignored: false });
    setFooterState({
        isWaitingForUpload: data.status === "uploading",
        isWaitingForRecording: data.status === "startingSender" || data.status === "startingReceiver" || data.status === "stopping"
    });
}

async function handleCoreStartRequest(data) {
    try {
        if (data.component === "sender") await startSender(data);
        else if (data.component === "receiver") await startReceiver(data);
        else throw new Error("Unsupported est-core component");

        appContext.socket.emit("est-event:coreStartResponse", {
            contextKey: data.contextKey,
            component: data.component,
            success: true
        });
    }
    catch (error) {
        console.error("Error starting est-core:", error);
        const cleanupPromise = appContext.audioTransport?.stop({ writeDiagnostics: false }) || Promise.resolve();
        cleanupPromise.catch((stopError) => console.error("Error cleaning up failed startup:", stopError));
        if (error.audioSetup) {
            const openDevicePicker = () => {
                if (appContext.windowMain && !appContext.windowMain.isDestroyed()) {
                    appContext.windowMain.webContents.send("ipc:audioDevicesOpen", { error: error.message });
                }
            };
            void cleanupPromise.then(openDevicePicker, openDevicePicker);
        }
        appContext.estCoreContextKey = null;
        appContext.socket.emit("est-event:coreStartResponse", {
            contextKey: data.contextKey,
            component: data.component ?? null,
            success: false,
            error: error.message
        });
    }
}

async function startSender(data) {
    appContext.estCoreContextKey = data.contextKey;
    setFooterState({ isWaitingForUpload: false, isWaitingForRecording: true });
    await prepareRecordingFiles();
    const deadline = Date.now() + 10000;
    await appContext.audioTransport.startSender(data.contextKey, appContext.audioDevices, deadline);
    const args = [
        "--mode",
        "sender",
        "--device-type",
        "stdio",
        "--peerip",
        data.core.ipAddress,
        ...(data.core.delay.native != null ? ["--native-delay", String(data.core.delay.native)] : []),
        ...(data.core.delay.echo != null ? ["--echo-delay", String(data.core.delay.echo)] : []),
        ...(data.core.packetloss.type != null ? ["--packetloss-type", String(data.core.packetloss.type)] : []),
        ...(data.core.packetloss.ratio != null ? ["--packetloss-ratio", String(data.core.packetloss.ratio)] : []),
        ...(data.core.packetloss.seed != null ? ["--packetloss-seed", String(data.core.packetloss.seed)] : []),
        ...(data.core.packetloss.burstModel != null ? ["--packetloss-burst-model", String(data.core.packetloss.burstModel)] : []),
        ...(data.core.packetloss.burstRatio != null ? ["--packetloss-burst-ratio", String(data.core.packetloss.burstRatio)] : [])
    ];
    const record = await spawnCore("sender", args, {
        deadline,
        onSpawn: (coreRecord) => appContext.audioTransport.setCore("sender", coreRecord),
        onFatal: (error, coreRecord) => appContext.audioTransport.handleCoreFailure("sender", coreRecord, error)
    });
    markCoreStarted(record);
    appContext.audioTransport.markComponentStarted("sender");
    appContext.audioTransport.enableCapture();
}

async function startReceiver(data) {
    if (data.contextKey !== appContext.estCoreContextKey) throw new Error("Receiver context does not match the active sender");
    const deadline = Date.now() + 10000;
    await appContext.audioTransport.startReceiver(data.contextKey, deadline);
    const args = ["--mode", "receiver", "--device-type", "stdio", ...(data.nativeGain != null ? ["--native-gain", String(data.nativeGain)] : []), ...(data.echoGain != null ? ["--echo-gain", String(data.echoGain)] : [])];
    const record = await spawnCore("receiver", args, {
        onSpawn: (coreRecord) => appContext.audioTransport.setCore("receiver", coreRecord),
        deadline,
        onFatal: (error, coreRecord) => appContext.audioTransport.handleCoreFailure("receiver", coreRecord, error)
    });
    markCoreStarted(record);
    appContext.audioTransport.markComponentStarted("receiver");
}

async function handleCoreStopRequest(data) {
    try {
        await appContext.audioTransport?.stop({ writeDiagnostics: data.upload !== false });
    }
    catch (error) {
        console.error("Error stopping audio condition:", error);
    }

    if (data.upload === false) {
        appContext.estCoreContextKey = null;
        await cleanupRecordingFiles();
        appContext.socket.emit("est-event:coreStopResponse", { contextKey: data.contextKey ?? null, upload: false });
        setFooterState({ isWaitingForUpload: false, isWaitingForRecording: false });
        return;
    }

    appContext.socket.emit("est-event:coreStopResponse", { contextKey: data.contextKey ?? null, upload: true });
    setFooterState({ isWaitingForUpload: false, isWaitingForRecording: false });
    await uploadRecordingFiles(data);
}

function setStoreState(storeName, payload) {
    if (!appContext.windowMain?.isDestroyed()) appContext.windowMain.webContents.send("ipc:storeSetValueRequest", { storeName, payload });
}

function setFooterState(payload) {
    setStoreState("ComponentFooter", payload);
}

async function prepareRecordingFiles() {
    const directory = path.dirname(appContext.configPath);
    await fs.promises.mkdir(directory, { recursive: true });
    await Promise.all(recordingFiles.map((fileName) => fs.promises.rm(path.join(directory, fileName), { force: true })));
}

async function cleanupRecordingFiles() {
    try {
        const directory = path.dirname(appContext.configPath || getGuiConfigPath());
        await fs.promises.mkdir(directory, { recursive: true });
        await Promise.all(recordingFiles.map((fileName) => fs.promises.rm(path.join(directory, fileName), { force: true })));
    }
    catch (error) {
        console.error("Error cleaning up EffectStreamer recording files:", error);
    }
}

function validateDiagnostics(fileData, contextKey) {
    if (fileData.length > 64 * 1024) throw new Error("Audio transport diagnostics exceed 64 KiB");
    const diagnostics = JSON.parse(fileData.toString("utf8"));
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics) || diagnostics.contextKey !== contextKey || typeof diagnostics.capture !== "object" || typeof diagnostics.playback !== "object" || typeof diagnostics.core !== "object") {
        throw new Error("Invalid audio-transport.json summary");
    }
}

async function readStableFile(fileName, contextKey) {
    const filePath = path.join(path.dirname(appContext.configPath), fileName);
    let lastSize = -1;
    let stableCount = 0;
    let lastError = null;

    for (let counter = 0; counter < 60; counter++) {
        try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > 0 && stat.size === lastSize) stableCount++;
            else {
                stableCount = 0;
                lastSize = stat.size;
            }
            if (stableCount >= 2) {
                const fileData = await fs.promises.readFile(filePath);
                if (fileName === "audio-transport.json") validateDiagnostics(fileData, contextKey);
                return fileData;
            }
        }
        catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw lastError || new Error("File did not appear or remained empty");
}

async function uploadRecordingFiles(data) {
    await Promise.all(
        recordingFiles.map(async (fileName) => {
            try {
                const fileData = await readStableFile(fileName, data.contextKey);
                appContext.socket.emit("est-event:fileTransferRequest", { contextKey: data.contextKey, fileName, fileData, testType: data.testType });
            }
            catch (error) {
                appContext.socket.emit("est-event:fileTransferRequest", { contextKey: data.contextKey, fileName, fileData: null, testType: data.testType, error: error.message });
            }
        })
    );
}
