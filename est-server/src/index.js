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
    const http = require("http");
    const express = require("express");
    const socketIo = require("socket.io");

    const { views } = require("./views.js");
    const { resolveConfigPath, loadConfig } = require("./config.js");
    const { ServerState } = require("./services/ServerState.js");
    const { ClientRegistry } = require("./services/ClientRegistry.js");
    const { SessionFiles } = require("./services/SessionFiles.js");
    const { ViewFlow } = require("./services/ViewFlow.js");
    const { ExperimentFlow } = require("./services/ExperimentFlow.js");
    const { EffectStreamerCore } = require("./services/EffectStreamerCore.js");

    const { estConfig, pretestFormConfig, testConfigKeys, testEnabled } = loadConfig(resolveConfigPath(__dirname));

    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        maxHttpBufferSize: 1e9, // Support for max. 1 GB file transfers
        serveClient: false
    });

    const state = new ServerState();
    const clientRegistry = new ClientRegistry({ state, io, views });
    const sessionFiles = new SessionFiles({ state, estConfig });
    const viewFlow = new ViewFlow({ state, estConfig, testEnabled, pretestFormConfig, clientRegistry });
    const experimentFlow = new ExperimentFlow({ state, estConfig, views, viewFlow, clientRegistry, sessionFiles });
    const effectStreamerCore = new EffectStreamerCore({ state, estConfig, testConfigKeys, clientRegistry });

    // ===========================================
    // ===== WEBSOCKET LOGIC =====================
    // ===========================================
    io.on("connection", (socket) => {
        // ===== disconnect ==============================
        socket.on("disconnect", () => {
            clientRegistry.disconnect(socket);
        });

        // ===== clientRegister ==============================
        socket.on("est-event:clientRegister", (data) => {
            clientRegistry.register(socket, data);
        });

        // ===== clientUnregister ==============================
        socket.on("est-event:clientUnregister", () => {
            clientRegistry.disconnect(socket);
        });

        // ===== viewChangeRequest ==============================
        socket.on("est-event:viewChangeRequest", (data) => {
            experimentFlow.handleViewChangeRequest(socket, data);
        });

        // ===== coreStartRequest ==============================
        socket.on("est-event:coreStartRequest", (data) => {
            effectStreamerCore.handleCoreStartRequest(socket, data);
        });

        // ===== coreStopRequest ==============================
        socket.on("est-event:coreStopRequest", (data) => {
            effectStreamerCore.handleCoreStopRequest(socket, data);
        });

        // ===== pretestSubmitRequest ==============================
        socket.on("est-event:pretestSubmitRequest", (data) => {
            const payload = data ?? {};

            const client = clientRegistry.getBySocketId(socket.id);
            if (!client) {
                clientRegistry.logIgnoredEvent(socket, "pretestSubmitRequest");
                return;
            }

            const serverFilename = "client-" + client.clientLabel + "-pretest-form.json";
            sessionFiles.saveFile("sessionDir", serverFilename, JSON.stringify(payload.formData, null, 4));

            clientRegistry.emitToSocket(socket.id, "est-event:pretestSubmitResponse");
        });

        // ===== fileTransferRequest ==============================
        socket.on("est-event:fileTransferRequest", (data) => {
            experimentFlow.handleFileTransferRequest(socket, data);
        });
    });

    // ===========================================
    // ===== HTTP SERVER LOGIC ===================
    // ===========================================
    server.listen(estConfig.server.port, estConfig.server.ipAddress, () => {
        sessionFiles.createFolderStructure();
        console.log("[Server] Server started (PID: " + process.pid + ") - Running on port " + estConfig.server.port);
    });
}

// ######################################################################################
// ##### MISSING EST_SERVER_TYPE ENVIRONMENT VAR ########################################
// ######################################################################################
else {
    console.error("You must specify the EST_SERVER_TYPE environment variable ('harness' or 'server')");
    process.exit(1);
}
