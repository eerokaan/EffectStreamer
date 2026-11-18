import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { handleNativeCommand } from "@/main/audio/command-handler";
import { NativeAudioRuntime } from "@/main/audio/native";
import { StdioAudioRuntime } from "@/main/audio/stdio";
import { getGuiConfigPath, readGuiConfig, saveAudioDeviceIds } from "@/main/lib/config";
import { getCoreSpawnOptions, getOperatingSystem } from "@/main/lib/coreProcess";
import { loadLocalEnrollment } from "@/main/lib/enrollment";
import { configureTransientRuntime } from "@/main/lib/transient";
import { createTransientPaths } from "@effectstreamer/common/transient-paths";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import path from "node:path";
import appContent from "@/main/lib/appContent";
import appInfo from "@/main/lib/appInfo";
import AudioTransport from "@/main/lib/audioTransport";
import { audioSetupSampleFilename } from "../shared/audio-setup-sample.js";

let windowMain, config, configPath, audio, publicConfiguration, initialization, activeScope, transport;
let closing = false;
const rendererRequests = new Map();

function assertMainFrame(event) {
    if (!windowMain || event.sender !== windowMain.webContents || event.senderFrame !== windowMain.webContents.mainFrame) throw new Error("Runtime IPC is limited to the application main frame");
}
function requestRendererControl(action, payload) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            rendererRequests.delete(requestId);
            reject(new Error("Renderer audio control timed out"));
        }, 10000);
        rendererRequests.set(requestId, { resolve, reject, timeout });
        windowMain.webContents.send("ipc:audioControlRequest", { requestId, action, payload });
    });
}
function loadPublicConfiguration() {
    publicConfiguration ||= (async () => {
        const response = await fetch(config.server.url + "/api/config");
        if (!response.ok) throw new Error("Unable to load coordinator configuration");
        return response.json();
    })();
    return publicConfiguration;
}

async function bootstrap() {
    initialization ||= (async () => {
        const url = config.server.url;
        const publicConfig = await loadPublicConfiguration();
        if (publicConfig.mode !== "local") throw new Error("This native client requires a local deployment; use the study URL for remote experiments");
        const sample = audioSetupSampleFilename(publicConfig.sessionLanguage);
        const credentialsPath = configPath + ".enrollment.json";
        const saved = await loadLocalEnrollment({ url, identity: config.client.identity, ipAddress: config.client.ipAddress, operatingSystem: getOperatingSystem(), credentialsPath });
        const source = process.env.EST_GUI_SOURCE_ROOT || app.getAppPath();
        const base = app.isPackaged ? path.join(process.resourcesPath, "est-core") : createTransientPaths({ anchor: path.dirname(source) }).path("est-core", "build", process.platform === "win32" ? "win" : "linux");
        const spawnOptions = getCoreSpawnOptions("receiver", { base });
        const options = {
            config,
            executable: spawnOptions.executable,
            env: spawnOptions.options.env,
            recordingRoot: path.join(app.getPath("home"), "effectstreamer", "recordings"),
            onFailure: (error) => windowMain?.webContents.send("ipc:runtimeFailure", { message: error.message, scope: activeScope })
        };
        if (config.audio.backend === "stdio") {
            transport = new AudioTransport({ window: windowMain, requestRendererControl, onFatal: options.onFailure });
            audio = new StdioAudioRuntime({ ...options, transport, spawnOptions });
        }
        else audio = new NativeAudioRuntime({ ...options, setupSample: app.isPackaged ? path.join(process.resourcesPath, "audio", sample) : path.join(source, "public", "audio", sample) });
        return { config: { ...publicConfig, audioBackend: config.audio.backend, selectedAudioDevices: config.audio.devices }, credentials: saved.credentials, url };
    })();
    return initialization;
}

async function mediaCommand(command) {
    if (command.type === "prepareCore") activeScope = { sessionId: command.sessionId, attemptId: command.attemptId, participantId: command.participantId };
    const result = await handleNativeCommand(audio, command);
    if (command.type === "stopCore" || command.type === "disconnected") activeScope = null;
    return result;
}

function registerIpc() {
    ipcMain.handle("ipc:runtime", async (event, request) => {
        assertMainFrame(event);
        const { operation, payload } = request || {};
        if (operation === "configuration") return loadPublicConfiguration();
        if (operation === "bootstrap") return bootstrap();
        if (!audio) throw new Error("Runtime must be bootstrapped first");
        if (operation === "devices.list") return audio.listDevices();
        if (operation === "devices.test") return audio.testDevices(payload);
        if (operation === "devices.save") {
            if (config.audio.backend === "native") await audio.saveDevices(payload);
            else if (audio.current) throw new Error("Cannot change devices during an active attempt");
            config = await saveAudioDeviceIds(configPath, { source: payload.sourceId, sink: payload.sinkId });
            audio.audio.devices = { source: payload.sourceId, sink: payload.sinkId };
            return true;
        }
        if (operation === "media.command") return mediaCommand(payload);
        if (operation === "media.dispose") return audio.dispose();
        if (operation === "recordings.collect") return audio.collect(payload, await bootstrap());
        throw new Error("Unauthorized native runtime operation");
    });
    ipcMain.handle("ipc:audioControlResponse", (event, response) => {
        assertMainFrame(event);
        const pending = rendererRequests.get(response?.requestId);
        if (!pending) return false;
        rendererRequests.delete(response.requestId);
        clearTimeout(pending.timeout);
        response.success ? pending.resolve(response.result) : pending.reject(new Error(response.error || "Renderer audio failed"));
        return true;
    });
    ipcMain.handle("ipc:audioFailure", (event, payload) => {
        assertMainFrame(event);
        transport?.handleRendererFailure(payload);
    });
}

async function start() {
    configureTransientRuntime(app);
    await app.whenReady();
    electronApp.setAppUserModelId(appInfo.name);
    configPath = getGuiConfigPath();
    config = await readGuiConfig(configPath);
    registerIpc();
    windowMain = new BrowserWindow({ width: 1000, height: 800, title: appInfo.displayName, autoHideMenuBar: true, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, devTools: !app.isPackaged, preload: path.join(__dirname, "../preload/index.js") } });
    const session = windowMain.webContents.session;
    const allowed = (contents, permission, details = {}) => contents === windowMain.webContents && details.isMainFrame !== false && config.audio.backend === "stdio" && (permission === "speaker-selection" || (permission === "media" && (details.mediaTypes || []).length > 0 && details.mediaTypes.every((type) => type.toLowerCase().startsWith("audio"))));
    session.setPermissionCheckHandler((contents, permission, _origin, details) => allowed(contents, permission, details));
    session.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed(contents, permission, details)));
    windowMain.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    windowMain.once("ready-to-show", () => windowMain.show());
    windowMain.on("close", (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        // Pending native WAVs are never removed merely because the app closes.
        void Promise.resolve(audio?.dispose())
            .catch(console.error)
            .finally(() => windowMain.destroy());
    });
    await appContent(windowMain, "windowMain.html");
}
app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window));
app.on("window-all-closed", () => app.quit());
void start().catch((error) => {
    console.error(error);
    dialog.showErrorBox("EffectStreamer", "EffectStreamer could not start. Please contact the study organizer.\n\nEffectStreamer konnte nicht gestartet werden. Bitte wenden Sie sich an die Studienleitung.");
    app.quit();
});
