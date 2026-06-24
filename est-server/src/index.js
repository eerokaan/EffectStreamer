const { spawn } = require("child_process");

// ######################################################################################
// ##### HARNESS ########################################################################
// ######################################################################################
if (process.env.EST_SERVER_TYPE === "harness") {
    console.log("[Harness] Harness started");
    let childProcess = null;

    const spawnServer = () => {
        console.log("[Harness] Starting server instance");
        childProcess = spawn(process.execPath, process.argv.slice(1), {
            stdio: "inherit",
            env: { ...process.env, EST_SERVER_TYPE: "server" }
        });

        childProcess.on("exit", (code, signal) => {
            if (signal === "SIGINT" || signal === "SIGTERM") {
                console.log("[Harness] Server instance killed by " + signal + ". Exiting harness");
                process.exit(0);
            }

            console.log("[Harness] Server instance exited (code: " + code + ") - Restarting in 500ms");
            setTimeout(spawnServer, 500);
        });
    };

    spawnServer();

    process.on("SIGINT", () => {
        if (childProcess) childProcess.kill("SIGINT");
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        if (childProcess) childProcess.kill("SIGTERM");
        process.exit(0);
    });
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
    const os = require("os");
    const path = require("path");
    const fs = require("fs");

    const estConfig = JSON.parse(fs.readFileSync(helperResolveConfigPath(), "UTF-8"));
    const pretestFormConfig = helperPretestFormNormalizeConfig(estConfig.pretestForm);
    const testConfigKeys = {
        sct: "short-conversation-test",
        lst: "listening-speaking-test"
    };
    const testEnabled = {
        sct: estConfig.tests?.[testConfigKeys.sct] !== false,
        lst: estConfig.tests?.[testConfigKeys.lst] !== false
    };

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

    const views = {
        waiting: "viewWaiting",
        welcome: "viewWelcome",
        pretest: "viewPretest",
        sctExp: "viewShortConversationTestExplanation",
        sct: "viewShortConversationTest",
        sctEval: "viewShortConversationTestEvaluation",
        lstExp: "viewListeningSpeakingTestExplanation",
        lst: "viewListeningSpeakingTest",
        lstEval: "viewListeningSpeakingTestEvaluation",
        break: "viewBreak",
        ending: "viewEnding"
    };
    const viewFlow = helperBuildViewFlow();

    let appState = {
        sessionDir: null,
        shutdownScheduled: false,
        clientsData: new Map(),
        clientsSocketRegistry: new Map(),
        conditionIndex: 0,
        conditionOrder: [],
        conditionListeningSpeakingTestIndex: 0,
        fileTransferCompletedKeys: new Set(),
        fileTransferPendingViewName: null,
        coreStopCompletedKeys: new Set(),
        gates: {
            viewChange: new Set(),
            coreStart: new Set(),
            fileTransfer: new Set()
        }
    };

    // ===========================================
    // ===== WEBSOCKET LOGIC =====================
    // ===========================================
    io.on("connection", (socket) => {
        // ===== disconnect ==============================
        socket.on("disconnect", () => {
            helperClientDisconnect(socket);
        });

        // ===== clientRegister ==============================
        socket.on("est-event:clientRegister", (data) => {
            helperClientRegister(socket, data);
        });

        // ===== clientUnregister ==============================
        socket.on("est-event:clientUnregister", () => {
            helperClientDisconnect(socket);
        });

        // ===== viewChangeRequest ==============================
        socket.on("est-event:viewChangeRequest", (data) => {
            const payload = data ?? {};

            const client = helperClientGetBySocketId(socket.id);
            if (!client) {
                helperClientLogIgnoredEvent(socket, "viewChangeRequest");
                return;
            }

            const view = viewFlow.find((view) => view.name === payload.currentView);
            if (!view) {
                helperClientLogIgnoredEvent(socket, "viewChangeRequest", "Requested view is unknown");
                return;
            }

            // Optional: Write scale data file if provided (for evaluation views)
            if (payload.scaleValues) {
                const roundSuffix = view.metadata.testType === "lst" ? "-r" + (appState.conditionListeningSpeakingTestIndex + 1) : "";
                const serverFilename = "client-" + client.clientLabel + "-" + view.metadata.testType + roundSuffix + "-scales.json";
                helperSaveFile("conditionDir", serverFilename, JSON.stringify(payload.scaleValues, null, 4));
            }

            // Views with direct passing
            const viewNext = helperGetNextView(view.name);

            if (view.passing === "direct") {
                io.to(socket.id).emit("est-event:viewChangeResponse", helperGetViewData(viewNext, socket.id));

                // On SCT and LST testing views: Notify partner that they were left in the room
                let peerSocketId = null;
                for (const registeredClient of appState.clientsData.values()) {
                    if (registeredClient.clientId !== client.clientId) {
                        peerSocketId = registeredClient.socketId;
                        break;
                    }
                }

                if (peerSocketId && (view.name === views.sct || view.name === views.lst)) {
                    io.to(peerSocketId).emit("est-event:viewChangeResponse", {
                        showDialog: true
                    });
                }
            }

            // Views with gated passing
            else if (view.passing === "gated") {
                appState.gates.viewChange.add(socket.id);

                // Both clients now want to proceed
                if (appState.gates.viewChange.size === 2) {
                    helperResolveGatedViewChange(view.name);
                }
            }
        });

        // ===== pretestSubmitRequest ==============================
        socket.on("est-event:pretestSubmitRequest", (data) => {
            const payload = data ?? {};

            const client = helperClientGetBySocketId(socket.id);
            if (!client) {
                helperClientLogIgnoredEvent(socket, "pretestSubmitRequest");
                return;
            }

            const serverFilename = "client-" + client.clientLabel + "-pretest-form.json";
            helperSaveFile("sessionDir", serverFilename, JSON.stringify(payload.formData, null, 4));

            io.to(socket.id).emit("est-event:pretestSubmitResponse");
        });

        // ===== coreStartRequest ==============================
        socket.on("est-event:coreStartRequest", (data) => {
            const payload = data ?? {};

            const thisClient = helperClientGetBySocketId(socket.id);
            if (!thisClient) {
                helperClientLogIgnoredEvent(socket, "coreStartRequest");
                return;
            }

            const coreRunSuffix = payload.testType === "lst" ? "-r" + (appState.conditionListeningSpeakingTestIndex + 1) : "";
            const coreRunKey = testConfigKeys[payload.testType] ? String(appState.conditionIndex + 1).padStart(4, "0") + ":" + payload.testType + coreRunSuffix : null;
            if (!coreRunKey) {
                helperClientLogIgnoredEvent(socket, "coreStartRequest", "The supplied test type is unknown");
                return;
            }
            if (appState.coreStopCompletedKeys.has(coreRunKey)) {
                helperClientLogIgnoredEvent(socket, "coreStartRequest", "est-core is already stopped");
                return;
            }

            const currentCondition = appState.conditionIndex === 0 ? estConfig.conditions.baseline[0] : estConfig.conditions.random[appState.conditionOrder[appState.conditionIndex - 1]];

            // Stage 1: Sender component (Direct response)
            if (payload.component === "sender") {
                let peerClient = null;
                for (const registeredClient of appState.clientsData.values()) {
                    if (registeredClient.clientId !== thisClient.clientId) {
                        peerClient = registeredClient;
                        break;
                    }
                }

                if (!peerClient) {
                    helperClientLogIgnoredEvent(socket, "coreStartRequest", "No peer is registered yet");
                    return;
                }

                const estCoreSettings = {
                    component: "sender",
                    testType: payload.testType,
                    peerIp: peerClient?.ipAddress,
                    deviceSource: thisClient.deviceSource,
                    nativeDelay: currentCondition.nativeDelay,
                    echoDelay: currentCondition.echoDelay,
                    packetlossType: currentCondition.packetlossType,
                    packetlossRatio: currentCondition.packetlossRatio,
                    packetlossSeed: currentCondition.packetlossSeed,
                    packetlossBurstModel: currentCondition.packetlossBurstModel,
                    packetlossBurstRatio: currentCondition.packetlossBurstRatio
                };
                io.to(socket.id).emit("est-event:coreStartResponse", estCoreSettings);
            }

            // Stage 2: Receiver component (Gated response)
            else if (payload.component === "receiver") {
                appState.gates.coreStart.add(socket.id);

                if (appState.gates.coreStart.size >= 2) {
                    helperClientEmitToAll("est-event:coreStartResponse", (clientSocketId, clientData) => ({
                        component: "receiver",
                        deviceSink: clientData.deviceSink,
                        nativeGain: currentCondition.nativeGain,
                        echoGain: currentCondition.echoGain
                    }));
                    appState.gates.coreStart.clear();
                }
            }
        });

        // ===== coreStopRequest ==============================
        socket.on("est-event:coreStopRequest", (data) => {
            const payload = data ?? {};

            const client = helperClientGetBySocketId(socket.id);
            if (!client) {
                helperClientLogIgnoredEvent(socket, "coreStopRequest", "The client is not registered (anymore)");
                return;
            }

            const coreRunSuffix = payload.testType === "lst" ? "-r" + (appState.conditionListeningSpeakingTestIndex + 1) : "";
            const coreRunKey = testConfigKeys[payload.testType] ? String(appState.conditionIndex + 1).padStart(4, "0") + ":" + payload.testType + coreRunSuffix : null;
            if (!coreRunKey) {
                helperClientLogIgnoredEvent(socket, "coreStopRequest", "The supplied test type is unknown");
                return;
            }

            if (appState.coreStopCompletedKeys.has(coreRunKey)) return;
            appState.coreStopCompletedKeys.add(coreRunKey);

            appState.gates.coreStart.clear();
            helperClientEmitToAll("est-event:coreStopResponse", { testType: payload.testType, upload: true });
        });

        // ===== fileTransferRequest ==============================
        socket.on("est-event:fileTransferRequest", (data) => {
            const payload = data ?? {};

            const client = helperClientGetBySocketId(socket.id);
            if (!client) {
                helperClientLogIgnoredEvent(socket, "fileTransferRequest");
                return;
            }

            // Construct filename: client-{a|b}-{sct|lst}-{microphone|headphones}.ogg
            const roundSuffix = payload.testType === "lst" ? "-r" + (appState.conditionListeningSpeakingTestIndex + 1) : "";
            const serverFilename = "client-" + client.clientLabel + "-" + payload.testType + roundSuffix + "-" + payload.fileName;

            // Write file to current condition directory
            helperSaveFile("conditionDir", serverFilename, Buffer.from(payload.fileData));

            // Gate: Track received files (2 files from 2 clients = 4 total)
            const transferKey = String(appState.conditionIndex + 1).padStart(4, "0") + ":" + payload.testType + roundSuffix;

            appState.gates.fileTransfer.add(transferKey + ":" + socket.id + ":" + payload.fileName);

            if (appState.gates.fileTransfer.size >= 4) {
                appState.fileTransferCompletedKeys.add(transferKey);
                helperClientEmitToAll("est-event:fileTransferResponse");

                // Try to resolve any pending double-gated view change
                if (appState.fileTransferPendingViewName && appState.gates.viewChange.size === 2) {
                    const pendingView = viewFlow.find((v) => v.name === appState.fileTransferPendingViewName);
                    const pendingTestType = pendingView?.metadata?.testType;
                    const pendingRoundSuffix = pendingTestType === "lst" ? "-r" + (appState.conditionListeningSpeakingTestIndex + 1) : "";
                    const pendingTransferKey = pendingTestType ? String(appState.conditionIndex + 1).padStart(4, "0") + ":" + pendingTestType + pendingRoundSuffix : null;

                    if (pendingTransferKey === transferKey) {
                        helperResolveGatedViewChange(appState.fileTransferPendingViewName);
                    }
                }

                appState.gates.fileTransfer.clear();
            }
        });
    });

    // ===========================================
    // ===== HELPER ==============================
    // ===========================================
    function helperBuildViewFlow() {
        const testViews = [];

        if (testEnabled.sct) {
            testViews.push({ name: views.sctExp, passing: "gated", metadata: {} }, { name: views.sct, passing: "direct", metadata: {} }, { name: views.sctEval, passing: "gated", metadata: { testType: "sct" } });
        }
        if (testEnabled.lst) {
            testViews.push({ name: views.lstExp, passing: "gated", metadata: {} }, { name: views.lst, passing: "direct", metadata: {} }, { name: views.lstEval, passing: "gated", metadata: { testType: "lst" } });
        }
        if (testViews.length > 0) {
            testViews[0].metadata = { ...testViews[0].metadata, loopBehaviour: "start" };

            const loopEndView = [...testViews].reverse().find((view) => view.metadata?.testType);
            loopEndView.metadata = { ...loopEndView.metadata, loopBehaviour: "end" };
        }

        return [{ name: views.waiting, passing: "direct", metadata: {} }, { name: views.welcome, passing: "direct", metadata: {} }, { name: views.pretest, passing: "gated", metadata: {} }, ...testViews, ...(testViews.length > 0 ? [{ name: views.break, passing: "gated", metadata: { loopBehaviour: "break" } }] : []), { name: views.ending, passing: "direct", metadata: {} }];
    }

    function helperClientCleanupSocketState(socketId) {
        appState.gates.viewChange.delete(socketId);
        appState.gates.coreStart.delete(socketId);

        for (const transferEntry of Array.from(appState.gates.fileTransfer)) {
            if (transferEntry.includes(":" + socketId + ":")) {
                appState.gates.fileTransfer.delete(transferEntry);
            }
        }
    }

    function helperClientDisconnect(socket) {
        const clientId = appState.clientsSocketRegistry.get(socket.id);
        if (!clientId) return;

        const client = appState.clientsData.get(clientId);
        helperClientCleanupSocketState(socket.id);
        appState.clientsSocketRegistry.delete(socket.id);

        if (!client || client.socketId !== socket.id) return;

        appState.clientsData.delete(clientId);

        if (appState.shutdownScheduled) return;
        appState.shutdownScheduled = true;

        console.log("[Server] Client disconnected: " + clientId + " (" + socket.id + ")");
        helperClientEmitToAll("est-event:coreStopResponse", { testType: null, upload: false });
        helperClientEmitToAll("est-event:viewChangeResponse", { currentView: views.waiting });

        console.log("[Server] Shutting down current server instance due to client disconnect");
        setTimeout(() => process.exit(), 500);
    }

    function helperClientEmitToAll(eventName, dataOrFunction) {
        appState.clientsData.forEach((clientData) => {
            const clientSocketId = clientData.socketId;

            if (dataOrFunction === undefined) {
                io.to(clientSocketId).emit(eventName);
            }
            else if (typeof dataOrFunction === "function") {
                io.to(clientSocketId).emit(eventName, dataOrFunction(clientSocketId, clientData));
            }
            else {
                io.to(clientSocketId).emit(eventName, dataOrFunction);
            }
        });
    }

    function helperClientGetBySocketId(socketId) {
        if (appState.shutdownScheduled) return null;

        const clientId = appState.clientsSocketRegistry.get(socketId);
        if (!clientId) return null;

        const client = appState.clientsData.get(clientId);
        if (!client || client.socketId !== socketId) return null;

        return client;
    }

    function helperClientLogIgnoredEvent(socket, eventName, customReason) {
        const clientId = appState.clientsSocketRegistry.get(socket.id);
        let reason = "n/a";

        if (appState.shutdownScheduled) {
            reason = "Server shutdown is scheduled";
        }
        if (customReason) {
            reason = customReason;
        }

        const message = "[Server] Ignoring " + eventName + " from " + clientId + " (" + socket.id + "): " + reason;
        console.log(message);
    }

    function helperClientRegister(socket, data) {
        const payload = data ?? {};

        if (appState.shutdownScheduled) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because shutdown is scheduled");
            socket.disconnect(true);
            return;
        }

        const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : null;
        if (!clientId) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because clientId is missing or invalid");
            socket.disconnect(true);
            return;
        }

        const mappedClientId = appState.clientsSocketRegistry.get(socket.id);
        if (mappedClientId && mappedClientId !== clientId) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because it is already mapped to client " + mappedClientId);
            socket.disconnect(true);
            return;
        }

        if (!appState.clientsData.has(clientId) && appState.clientsData.size >= 2) {
            console.log("[Server] Rejecting client registration for " + clientId + " because two clients are already registered");
            socket.disconnect(true);
            return;
        }

        const clientsWereReady = appState.clientsData.size === 2;
        const existingClient = appState.clientsData.get(clientId);
        let clientSlot = existingClient;

        if (!clientSlot) {
            const usedClientIndexes = new Set();
            appState.clientsData.forEach((client) => {
                usedClientIndexes.add(client.clientIndex);
            });

            if (!usedClientIndexes.has(0)) {
                clientSlot = { clientIndex: 0, clientLabel: "a" };
            }
            else if (!usedClientIndexes.has(1)) {
                clientSlot = { clientIndex: 1, clientLabel: "b" };
            }
        }

        if (!clientSlot) {
            console.log("[Server] Rejecting client registration for " + clientId + " because no client slot is available");
            socket.disconnect(true);
            return;
        }

        if (existingClient?.socketId && existingClient.socketId !== socket.id) {
            const oldSocketId = existingClient.socketId;
            helperClientCleanupSocketState(oldSocketId);
            appState.clientsSocketRegistry.delete(oldSocketId);

            const oldSocket = io.sockets.sockets.get(oldSocketId);
            if (oldSocket) oldSocket.disconnect(true);

            console.log("[Server] Client reconnected: " + clientId + " (" + oldSocketId + " -> " + socket.id + ")");
        }
        else if (existingClient) {
            console.log("[Server] Client registration refreshed: " + clientId + " (" + socket.id + ")");
        }
        else {
            console.log("[Server] Client registered: " + clientId + " (" + socket.id + ")");
        }

        appState.clientsData.set(clientId, {
            clientId,
            socketId: socket.id,
            clientIndex: clientSlot.clientIndex,
            clientLabel: clientSlot.clientLabel,
            operatingSystem: payload.operatingSystem,
            ipAddress: payload.ipAddress,
            deviceSource: payload.deviceSource,
            deviceSink: payload.deviceSink
        });
        appState.clientsSocketRegistry.set(socket.id, clientId);

        if (!clientsWereReady && appState.clientsData.size === 2) {
            helperClientEmitToAll("est-event:viewChangeResponse", { currentView: views.welcome });
        }
    }

    function helperCreateFolderStructure() {
        const effectstreamerDir = path.join(os.homedir(), "effectstreamer");
        fs.mkdirSync(effectstreamerDir, { recursive: true });

        // Determine next session number (n+1 from existing directories)
        const existing = fs
            .readdirSync(effectstreamerDir)
            .filter((name) => /^\d{4}$/.test(name))
            .map(Number);
        const sessionNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;

        appState.sessionDir = path.join(effectstreamerDir, String(sessionNum).padStart(4, "0"));
        fs.mkdirSync(appState.sessionDir);

        // Create condition directories
        const roundsTotal = estConfig.conditions.baseline.length + estConfig.conditions.random.length;
        for (let counter = 1; counter <= roundsTotal; counter++) {
            fs.mkdirSync(path.join(appState.sessionDir, String(counter).padStart(4, "0")));
        }
    }

    function helperGetNextView(currentView) {
        const viewIndex = viewFlow.findIndex((view) => view.name === currentView);
        const view = viewFlow[viewIndex];

        if (currentView === views.lstEval && appState.conditionListeningSpeakingTestIndex === 0) {
            return views.lst;
        }

        // When current view indicates a loop end: Either exit (viewEnding), show break (viewBreak) or loop back
        if (view.metadata?.loopBehaviour === "end") {
            const roundsTotal = estConfig.conditions.baseline.length + estConfig.conditions.random.length;

            if (appState.conditionIndex >= roundsTotal - 1) {
                return views.ending;
            }
            else if (appState.conditionIndex + 1 === Math.floor(roundsTotal / 2)) {
                return viewFlow.find((view) => view.metadata?.loopBehaviour === "break").name;
            }
            else {
                return viewFlow.find((view) => view.metadata?.loopBehaviour === "start").name;
            }
        }

        // When current view indicates a break: Resume to the loop
        if (view.metadata?.loopBehaviour === "break") {
            return viewFlow.find((view) => view.metadata?.loopBehaviour === "start").name;
        }

        // When nothing applies, just continue with the next view
        return viewFlow[viewIndex + 1].name;
    }

    function helperGetViewData(viewName, clientSocketId) {
        if (viewName === views.pretest) {
            return { currentView: viewName, pretestForm: pretestFormConfig };
        }

        const isSct = viewName === views.sct;
        const isLst = viewName === views.lst;
        const isLstEvaluation = viewName === views.lstEval;

        if (isSct || isLst || isLstEvaluation) {
            const client = helperClientGetBySocketId(clientSocketId);
            if (!client) return { currentView: viewName };

            const clientNumber = client.clientIndex === 0 ? "01" : "02";
            const conditionPadded = String(appState.conditionIndex + 1).padStart(2, "0");
            const clientConditionAsset = "client_" + clientNumber + "/" + conditionPadded + ".png";

            let conditionListeningSpeakingTestRole = null;
            if (isLst || isLstEvaluation) {
                if (appState.conditionListeningSpeakingTestIndex === 0) {
                    conditionListeningSpeakingTestRole = client.clientIndex === 0 ? "speaker" : "listener";
                }
                else {
                    conditionListeningSpeakingTestRole = client.clientIndex === 0 ? "listener" : "speaker";
                }
            }

            let conditionAsset = null;

            if (isSct) {
                conditionAsset = clientConditionAsset;
            }
            else if (isLst) {
                conditionAsset = conditionListeningSpeakingTestRole === "speaker" ? clientConditionAsset : "listener.png";
            }

            const response = {
                currentView: viewName,
                conditionAsset: conditionAsset
            };

            if (isLst || isLstEvaluation) {
                response.conditionListeningSpeakingTestIndex = appState.conditionListeningSpeakingTestIndex;
                response.conditionListeningSpeakingTestRole = conditionListeningSpeakingTestRole;
            }

            return response;
        }

        return { currentView: viewName };
    }

    function helperPretestFormError(configPath, message) {
        throw new Error("[Config] " + configPath + " " + message);
    }

    function helperPretestFormNormalizeConfig(pretestForm) {
        if (!Array.isArray(pretestForm) || pretestForm.length === 0) {
            helperPretestFormError("pretestForm", "must be a non-empty array");
        }

        const fieldNames = new Set();

        return pretestForm.map((field, index) => {
            const fieldPath = "pretestForm[" + index + "]";
            helperPretestFormValidatePlainObject(field, fieldPath);

            const name = helperPretestFormNormalizeRequiredString(field.name, fieldPath + ".name");
            if (fieldNames.has(name)) {
                helperPretestFormError(fieldPath + ".name", "must be unique");
            }
            fieldNames.add(name);

            const type = helperPretestFormNormalizeRequiredString(field.type, fieldPath + ".type");
            if (!["input", "select", "slider", "switch"].includes(type)) {
                helperPretestFormError(fieldPath + ".type", "must be one of: input, select, slider, switch");
            }

            const normalizedField = {
                name,
                type,
                label: helperPretestFormNormalizeRequiredString(field.label, fieldPath + ".label"),
                required: helperPretestFormNormalizeRequired(field.required, type, fieldPath + ".required"),
                layoutWidth: helperPretestFormNormalizeLayoutWidth(field, fieldPath)
            };

            const description = helperPretestFormNormalizeOptionalString(field.description, fieldPath + ".description");
            if (description) normalizedField.description = description;

            const placeholder = helperPretestFormNormalizeOptionalString(field.placeholder, fieldPath + ".placeholder");
            if (placeholder) normalizedField.placeholder = placeholder;

            if (type === "input") {
                return helperPretestFormNormalizeInputField(field, normalizedField, fieldPath);
            }
            else if (type === "select") {
                return helperPretestFormNormalizeSelectField(field, normalizedField, fieldPath);
            }
            else if (type === "slider") {
                return helperPretestFormNormalizeSliderField(field, normalizedField, fieldPath);
            }
            else if (type === "switch") {
                return helperPretestFormNormalizeSwitchField(field, normalizedField, fieldPath);
            }
        });
    }

    function helperPretestFormNormalizeLayoutWidth(field, fieldPath) {
        if (field.layout !== undefined) {
            helperPretestFormError(fieldPath + ".layout", "is no longer supported; use layoutWidth instead");
        }

        const layoutWidth = field.layoutWidth ?? 12;
        if (!Number.isInteger(layoutWidth) || layoutWidth < 1 || layoutWidth > 12) {
            helperPretestFormError(fieldPath + ".layoutWidth", "must be an integer from 1 through 12");
        }

        return layoutWidth;
    }

    function helperPretestFormNormalizeRequired(required, type, configPath) {
        if (required == null) {
            return type === "input" || type === "select";
        }
        if (typeof required !== "boolean") {
            helperPretestFormError(configPath, "must be a boolean");
        }
        return required;
    }

    function helperPretestFormNormalizeInputField(field, normalizedField, fieldPath) {
        const inputType = field.inputType == null ? "text" : helperPretestFormNormalizeRequiredString(field.inputType, fieldPath + ".inputType");
        if (!["text", "number"].includes(inputType)) {
            helperPretestFormError(fieldPath + ".inputType", "must be one of: text, number");
        }

        const validation = helperPretestFormNormalizeInputValidation(field.validation, inputType, fieldPath + ".validation");
        const normalizedInput = { ...normalizedField, inputType, validation };

        if (field.defaultValue !== undefined) {
            helperPretestFormValidateDefaultValue(field.defaultValue, validation, fieldPath + ".defaultValue");
            normalizedInput.defaultValue = field.defaultValue;
        }

        return normalizedInput;
    }

    function helperPretestFormNormalizeInputValidation(validation, inputType, configPath) {
        const normalizedValidation = helperPretestFormNormalizeValidationObject(validation, configPath);
        const valueType = normalizedValidation.valueType == null ? (inputType === "number" ? "number" : "string") : helperPretestFormNormalizeRequiredString(normalizedValidation.valueType, configPath + ".valueType");

        if (!["string", "number", "integer"].includes(valueType)) {
            helperPretestFormError(configPath + ".valueType", "must be one of: string, number, integer");
        }

        const result = { valueType };

        if (valueType === "string") {
            if (normalizedValidation.minLength != null) result.minLength = helperPretestFormNormalizeNonNegativeInteger(normalizedValidation.minLength, configPath + ".minLength");
            if (normalizedValidation.maxLength != null) result.maxLength = helperPretestFormNormalizeNonNegativeInteger(normalizedValidation.maxLength, configPath + ".maxLength");
            if (result.minLength != null && result.maxLength != null && result.minLength > result.maxLength) {
                helperPretestFormError(configPath, "minLength must be less than or equal to maxLength");
            }
            if (normalizedValidation.pattern != null) {
                const pattern = helperPretestFormNormalizeRequiredString(normalizedValidation.pattern, configPath + ".pattern");
                try {
                    new RegExp(pattern);
                }
                catch {
                    helperPretestFormError(configPath + ".pattern", "must be a valid regular expression");
                }
                result.pattern = pattern;
            }
        }
        else {
            if (normalizedValidation.min != null) result.min = helperPretestFormNormalizeNumber(normalizedValidation.min, configPath + ".min");
            if (normalizedValidation.max != null) result.max = helperPretestFormNormalizeNumber(normalizedValidation.max, configPath + ".max");
            if (result.min != null && result.max != null && result.min > result.max) {
                helperPretestFormError(configPath, "min must be less than or equal to max");
            }
        }

        return result;
    }

    function helperPretestFormNormalizeSelectField(field, normalizedField, fieldPath) {
        if (!Array.isArray(field.options) || field.options.length === 0) {
            helperPretestFormError(fieldPath + ".options", "must be a non-empty array");
        }

        const optionValues = new Set();
        const options = field.options.map((option, index) => {
            const optionPath = fieldPath + ".options[" + index + "]";
            helperPretestFormValidatePlainObject(option, optionPath);

            const value = helperPretestFormNormalizeRequiredString(option.value, optionPath + ".value");
            if (optionValues.has(value)) {
                helperPretestFormError(optionPath + ".value", "must be unique within this select field");
            }
            optionValues.add(value);

            return {
                value,
                label: helperPretestFormNormalizeRequiredString(option.label, optionPath + ".label")
            };
        });

        if (field.defaultValue !== undefined) {
            const defaultValue = helperPretestFormNormalizeRequiredString(field.defaultValue, fieldPath + ".defaultValue");
            if (!optionValues.has(defaultValue)) {
                helperPretestFormError(fieldPath + ".defaultValue", "must match one of the configured option values");
            }
            return { ...normalizedField, options, defaultValue };
        }

        return { ...normalizedField, options };
    }

    function helperPretestFormNormalizeSliderField(field, normalizedField, fieldPath) {
        const validation = helperPretestFormNormalizeValidationObject(field.validation, fieldPath + ".validation");
        const min = validation.min == null ? 0 : helperPretestFormNormalizeNumber(validation.min, fieldPath + ".validation.min");
        const max = validation.max == null ? 100 : helperPretestFormNormalizeNumber(validation.max, fieldPath + ".validation.max");
        const step = validation.step == null ? 1 : helperPretestFormNormalizeNumber(validation.step, fieldPath + ".validation.step");

        if (min > max) {
            helperPretestFormError(fieldPath + ".validation", "min must be less than or equal to max");
        }
        if (step <= 0) {
            helperPretestFormError(fieldPath + ".validation.step", "must be greater than 0");
        }

        const defaultValue = field.defaultValue == null ? helperPretestFormGetSliderDefaultValue(min, max, step) : helperPretestFormNormalizeNumber(field.defaultValue, fieldPath + ".defaultValue");
        if (defaultValue < min || defaultValue > max) {
            helperPretestFormError(fieldPath + ".defaultValue", "must be within the configured slider range");
        }
        if (!helperPretestFormStepAligned(defaultValue, min, step)) {
            helperPretestFormError(fieldPath + ".defaultValue", "must align with validation.step");
        }

        const normalizedSlider = {
            ...normalizedField,
            validation: { min, max, step },
            defaultValue
        };

        if (field.marks != null) {
            helperPretestFormValidatePlainObject(field.marks, fieldPath + ".marks");
            const minLabel = helperPretestFormNormalizeOptionalString(field.marks.minLabel, fieldPath + ".marks.minLabel");
            const maxLabel = helperPretestFormNormalizeOptionalString(field.marks.maxLabel, fieldPath + ".marks.maxLabel");
            if (minLabel || maxLabel) {
                normalizedSlider.marks = {};
                if (minLabel) normalizedSlider.marks.minLabel = minLabel;
                if (maxLabel) normalizedSlider.marks.maxLabel = maxLabel;
            }
        }

        return normalizedSlider;
    }

    function helperPretestFormNormalizeSwitchField(field, normalizedField, fieldPath) {
        if (field.defaultValue != null && typeof field.defaultValue !== "boolean") {
            helperPretestFormError(fieldPath + ".defaultValue", "must be a boolean");
        }

        return { ...normalizedField, defaultValue: field.defaultValue ?? false };
    }

    function helperPretestFormNormalizeValidationObject(validation, configPath) {
        if (validation == null) {
            return {};
        }

        helperPretestFormValidatePlainObject(validation, configPath);
        return validation;
    }

    function helperPretestFormValidateDefaultValue(defaultValue, validation, configPath) {
        if (validation.valueType === "string" && typeof defaultValue !== "string") {
            helperPretestFormError(configPath, "must be a string");
        }
        if (validation.valueType === "string" && validation.minLength != null && defaultValue.length < validation.minLength) {
            helperPretestFormError(configPath, "must satisfy validation.minLength");
        }
        if (validation.valueType === "string" && validation.maxLength != null && defaultValue.length > validation.maxLength) {
            helperPretestFormError(configPath, "must satisfy validation.maxLength");
        }
        if (validation.valueType === "string" && validation.pattern != null && !new RegExp(validation.pattern).test(defaultValue)) {
            helperPretestFormError(configPath, "must satisfy validation.pattern");
        }
        if (validation.valueType === "number" && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) {
            helperPretestFormError(configPath, "must be a number");
        }
        if (validation.valueType === "integer" && !Number.isInteger(defaultValue)) {
            helperPretestFormError(configPath, "must be an integer");
        }
        if ((validation.valueType === "number" || validation.valueType === "integer") && validation.min != null && defaultValue < validation.min) {
            helperPretestFormError(configPath, "must satisfy validation.min");
        }
        if ((validation.valueType === "number" || validation.valueType === "integer") && validation.max != null && defaultValue > validation.max) {
            helperPretestFormError(configPath, "must satisfy validation.max");
        }
    }

    function helperPretestFormValidatePlainObject(value, configPath) {
        if (value == null || typeof value !== "object" || Array.isArray(value)) {
            helperPretestFormError(configPath, "must be an object");
        }
    }

    function helperPretestFormNormalizeRequiredString(value, configPath) {
        if (typeof value !== "string" || value.trim().length === 0) {
            helperPretestFormError(configPath, "must be a non-empty string");
        }
        return value.trim();
    }

    function helperPretestFormNormalizeOptionalString(value, configPath) {
        if (value == null) {
            return null;
        }
        if (typeof value !== "string") {
            helperPretestFormError(configPath, "must be a string");
        }

        const trimmedValue = value.trim();
        return trimmedValue.length > 0 ? trimmedValue : null;
    }

    function helperPretestFormNormalizeNumber(value, configPath) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            helperPretestFormError(configPath, "must be a finite number");
        }
        return value;
    }

    function helperPretestFormNormalizeNonNegativeInteger(value, configPath) {
        if (!Number.isInteger(value) || value < 0) {
            helperPretestFormError(configPath, "must be a non-negative integer");
        }
        return value;
    }

    function helperPretestFormStepAligned(value, min, step) {
        const quotient = (value - min) / step;
        return Math.abs(quotient - Math.round(quotient)) < 1e-9;
    }

    function helperPretestFormGetSliderDefaultValue(min, max, step) {
        const stepCount = Math.floor((max - min) / step);
        return min + Math.floor(stepCount / 2) * step;
    }

    function helperResolveConfigPath() {
        const configName = "est-config.json";

        if (process.resourcesPath) {
            return path.join(process.resourcesPath, configName);
        }
        else if (process.pkg) {
            return path.join(path.dirname(process.execPath), configName);
        }
        else {
            return path.join(__dirname, "..", configName);
        }
    }

    function helperResolveGatedViewChange(currentViewName) {
        const viewNext = helperGetNextView(currentViewName);
        const view = viewFlow.find((view) => view.name === currentViewName);
        const currentViewTestType = view?.metadata?.testType;

        if (currentViewTestType) {
            const roundSuffix = currentViewTestType === "lst" ? "-r" + (appState.conditionListeningSpeakingTestIndex + 1) : "";
            const transferKey = String(appState.conditionIndex + 1).padStart(4, "0") + ":" + currentViewTestType + roundSuffix;

            if (!appState.fileTransferCompletedKeys.has(transferKey)) {
                appState.fileTransferPendingViewName = currentViewName;
                return;
            }
        }

        const isFirstLstEval = currentViewName === views.lstEval && appState.conditionListeningSpeakingTestIndex === 0;
        const isLoopEndView = view.metadata?.loopBehaviour === "end" && !isFirstLstEval;
        const loopStartViewName = viewFlow.find((view) => view.metadata?.loopBehaviour === "start")?.name;

        if (isLoopEndView && viewNext !== views.ending) {
            appState.conditionIndex++;

            const currentCondition = appState.conditionIndex === 0 ? estConfig.conditions.baseline[0] : estConfig.conditions.random[appState.conditionOrder[appState.conditionIndex - 1]];
            console.log("[Server] Round " + appState.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
            helperSaveFile("conditionDir", "condition-settings.json", JSON.stringify(currentCondition, null, 4));
        }
        else if (viewNext === loopStartViewName && appState.conditionIndex === 0) {
            const indices = estConfig.conditions.random.map((_, counter) => counter);
            for (let counter00 = indices.length - 1; counter00 > 0; counter00--) {
                const counter01 = Math.floor(Math.random() * (counter00 + 1));
                [indices[counter00], indices[counter01]] = [indices[counter01], indices[counter00]];
            }
            appState.conditionOrder = indices;

            const currentCondition = appState.conditionIndex === 0 ? estConfig.conditions.baseline[0] : estConfig.conditions.random[appState.conditionOrder[appState.conditionIndex - 1]];
            console.log("[Server] Round " + appState.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
            helperSaveFile("conditionDir", "condition-settings.json", JSON.stringify(currentCondition, null, 4));
        }

        if (viewNext === views.lstExp) {
            appState.conditionListeningSpeakingTestIndex = 0;
        }
        if (isFirstLstEval) {
            appState.conditionListeningSpeakingTestIndex = 1;
        }
        if (isLoopEndView) {
            appState.conditionListeningSpeakingTestIndex = 0;
        }

        helperClientEmitToAll("est-event:viewChangeResponse", (clientSocketId) => helperGetViewData(viewNext, clientSocketId));
        appState.gates.viewChange.clear();
        appState.fileTransferPendingViewName = null;

        if (viewNext === views.ending) {
            setTimeout(() => {
                console.log("[Server] Shutting down current server instance due to experiment completion");
                process.exit();
            }, 60000);
        }
    }

    function helperSaveFile(location, filename, data) {
        const conditionDirName = String(appState.conditionIndex + 1).padStart(4, "0");

        let filePath = null;
        if (location === "sessionDir") {
            filePath = path.join(appState.sessionDir, filename);
        }
        else if (location === "conditionDir") {
            filePath = path.join(appState.sessionDir, conditionDirName, filename);
        }
        else {
            throw new Error("Unknown session file location: " + location);
        }

        fs.writeFileSync(filePath, data);
    }

    // ===========================================
    // ===== HTTP SERVER LOGIC ===================
    // ===========================================
    server.listen(estConfig.server.port, estConfig.server.ipAddress, () => {
        helperCreateFolderStructure();
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
