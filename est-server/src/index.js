const { Harness } = require("./harness.js");

// ######################################################################################
// ##### HARNESS ########################################################################
// ######################################################################################
if (process.env.EST_SERVER_TYPE === "harness") {
    new Harness().run();
}

// ######################################################################################
// ##### SERVER #########################################################################
// ######################################################################################
else if (process.env.EST_SERVER_TYPE === "server") {
    // ===========================================
    // ===== COMMON ==============================
    // ===========================================
    // Setup basic server scaffold
    const http = require("http");
    const express = require("express");
    const socketIo = require("socket.io");

    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        maxHttpBufferSize: 1073741824,
        serveClient: false
    });

    // Bootstraps, services and utilities
    const { views } = require("./bootstraps/views.js");
    const { loadConfig } = require("./bootstraps/configManager.js");
    const { ServerState } = require("./services/ServerState.js");
    const { ClientRegistry } = require("./services/ClientRegistry.js");
    const { SessionFiles } = require("./services/SessionFiles.js");
    const { ViewFlow } = require("./services/ViewFlow.js");
    const { ExperimentFlow } = require("./services/ExperimentFlow.js");
    const { EffectStreamerCore } = require("./services/EffectStreamerCore.js");
    const { buildPretestFormFilename } = require("./utils/filenames.js");
    const { isObject } = require("./utils/validation.js");

    // Load and parse config
    console.log("[Server] Loading and validating config");
    let config = null;

    try {
        config = loadConfig();
    }
    catch (error) {
        console.error("[Server] Failed to load config: " + error.message);
        process.exit(1);
    }

    // Initialize runtime: ServerState and SessionFiles
    const state = new ServerState();
    const sessionFiles = new SessionFiles({
        state,
        config
    });

    // Initialize runtime: ClientRegistry
    const clientRegistry = new ClientRegistry({
        state,
        io,
        views
    });
    clientRegistry.setClientsReadyHandler(() => {
        state.resetExperimentSession();
        sessionFiles.createFolderStructure();
    });

    // Initialize runtime: EffectStreamerCore
    const effectStreamerCore = new EffectStreamerCore({
        state,
        config,
        clientRegistry,
        sessionFiles
    });
    effectStreamerCore.setRecordingContextCompletedHandler((recordingContext) => {
        experimentFlow.resolvePendingRecordingViewChanges(recordingContext);
    });

    // Initialize runtime: ViewFlow
    const viewFlow = new ViewFlow({
        state,
        config
    });

    // Initialize runtime: ExperimentFlow
    const experimentFlow = new ExperimentFlow({
        state,
        config,
        views,
        viewFlow,
        clientRegistry,
        sessionFiles,
        effectStreamerCore
    });

    // ===========================================
    // ===== WEBSOCKET LOGIC =====================
    // ===========================================
    io.on("connection", (socket) => {
        // ===== disconnect ==============================
        socket.on("disconnect", () => {
            clientRegistry.handleUnregister(socket);
        });

        // ===== clientRegister ==============================
        socket.on("est-event:clientRegister", (data) => {
            clientRegistry.handleRegister(socket, data);
        });

        // ===== clientUnregister ==============================
        socket.on("est-event:clientUnregister", () => {
            clientRegistry.handleUnregister(socket);
        });

        // ===== viewChangeRequest ==============================
        socket.on("est-event:viewChangeRequest", (data) => {
            experimentFlow.handleViewChangeRequest(socket, data);
        });

        // ===== pretestSaveRequest ==============================
        socket.on("est-event:pretestSaveRequest", (data) => {
            const client = clientRegistry.fetchClient(socket.id);
            if (!client) {
                clientRegistry.logEventError(socket, "pretestSaveRequest", "Client is unknown (Perhaps ongoing shutdown?)");
                return;
            }

            if (!isObject(data)) {
                clientRegistry.logEventError(socket, "pretestSaveRequest", "Form data is missing or invalid");
                return;
            }

            if (!isObject(data.formData)) {
                clientRegistry.logEventError(socket, "pretestSaveRequest", "Form data is missing or invalid");
                return;
            }

            const serverFilename = buildPretestFormFilename(client.clientId);
            sessionFiles.saveFile("sessionDir", serverFilename, JSON.stringify(data.formData, null, 4));

            clientRegistry.emitToSocket(socket.id, "est-event:pretestSaveResponse");
        });

        // ===== fileTransferRequest ==============================
        socket.on("est-event:fileTransferRequest", (data) => {
            effectStreamerCore.handleFileTransferRequest(socket, data);
        });

        // ===== coreStartResponse ==============================
        socket.on("est-event:coreStartResponse", (data) => {
            effectStreamerCore.handleCoreStartResponse(socket, data);
        });

        // ===== coreStopResponse ==============================
        socket.on("est-event:coreStopResponse", (data) => {
            effectStreamerCore.handleCoreStopResponse(socket, data);
        });

        // ===== recordingStateUpdateResponse ==============================
        socket.on("est-event:recordingStateUpdateResponse", (data) => {
            effectStreamerCore.handleRecordingStateUpdateResponse(socket, data);
        });
    });

    // ===========================================
    // ===== HTTP SERVER LOGIC ===================
    // ===========================================
    server.listen(config.server.port, config.server.ipAddress, () => {
        console.log("[Server] Server started (PID: " + process.pid + ") - Running on port " + config.server.port);
    });
}

// ######################################################################################
// ##### MISSING EST_SERVER_TYPE ENVIRONMENT VAR ########################################
// ######################################################################################
else {
    console.error("You must specify the EST_SERVER_TYPE environment variable ('harness' or 'server')");
    process.exit(1);
}
