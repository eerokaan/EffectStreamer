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
    const testConfigKeys = {
        sct: "short-conversation-test",
        lst: "listening-speaking-test"
    };
    const enabledTests = {
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
        gates: {
            viewChange: new Set(),
            coreStart: new Set(),
            coreStop: new Set(),
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

            const view = viewFlow.find((v) => v.name === payload.currentView);
            if (!view) {
                helperClientLogIgnoredEvent(socket, "viewChangeRequest", "requested view is unknown");
                return;
            }

            // Optional: Write scale data file if provided (for evaluation views)
            if (payload.scaleValues) {
                const roundSuffix = helperGetRoundSuffix(view.metadata.testType);
                const serverFilename = "client-" + client.clientLabel + "-" + view.metadata.testType + roundSuffix + "-scales.json";
                helperSaveSessionFile(serverFilename, JSON.stringify(payload.scaleValues, null, 4), true);
            }

            // Views with direct passing
            const viewNext = helperGetNextView(view.name);

            if (view.passing === "direct") {
                io.to(socket.id).emit("est-event:viewChangeResponse", helperGetViewData(viewNext, socket.id));

                // On SCT and LST testing views: Notify partner that they were left in the room
                const peerSocketId = helperClientGetPeerSocketId(socket.id);
                if (peerSocketId && (view.name === views.sct || view.name === views.lst)) {
                    io.to(peerSocketId).emit("est-event:viewChangeResponse", {
                        showDialog: true
                    });
                }
            }

            // Views with gated passing (Manual gate: helperGateResolve cannot be used due to deferred double-gate)
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
            helperSaveSessionFile(serverFilename, JSON.stringify(payload.formData, null, 4), false);

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

            const currentCondition = helperGetCurrentCondition();

            // Stage 1: Sender component (Direct response)
            if (payload.component === "sender") {
                const peerSocketId = helperClientGetPeerSocketId(socket.id);
                const peerClient = peerSocketId ? helperClientGetBySocketId(peerSocketId) : null;

                if (!peerClient) {
                    helperClientLogIgnoredEvent(socket, "coreStartRequest", "no peer is registered yet");
                    return;
                }

                const estCoreSettings = {
                    component: "sender",
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
                helperGateResolve(appState.gates.coreStart, socket.id, 2, () => {
                    helperClientEmitToAll("est-event:coreStartResponse", (clientSocketId, clientData) => ({
                        component: "receiver",
                        deviceSink: clientData.deviceSink,
                        nativeGain: currentCondition.nativeGain,
                        echoGain: currentCondition.echoGain
                    }));
                });
            }
        });

        // ===== coreStopRequest ==============================
        socket.on("est-event:coreStopRequest", (data) => {
            const payload = data ?? {};

            const client = helperClientGetBySocketId(socket.id);
            if (!client) {
                helperClientLogIgnoredEvent(socket, "coreStopRequest", "the client is not registered (anymore)");
                return;
            }

            helperGateResolve(appState.gates.coreStop, socket.id, 2, () => {
                helperClientEmitToAll("est-event:coreStopResponse", { testType: payload.testType, upload: true });
            });
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
            const originalName = payload.filename.replace(".ogg", "");
            const roundSuffix = helperGetRoundSuffix(payload.testType);
            const serverFilename = "client-" + client.clientLabel + "-" + payload.testType + roundSuffix + "-" + originalName + ".ogg";

            // Write file to current condition directory
            helperSaveSessionFile(serverFilename, Buffer.from(payload.fileData), true);

            // Gate: Track received files (2 files from 2 clients = 4 total)
            const transferKey = helperGetTransferKeyForTestType(payload.testType);

            helperGateResolve(appState.gates.fileTransfer, transferKey + ":" + socket.id + ":" + payload.filename, 4, () => {
                appState.fileTransferCompletedKeys.add(transferKey);
                helperClientEmitToAll("est-event:fileTransferResponse");

                // Try to resolve any pending double-gated view change
                if (appState.fileTransferPendingViewName && helperGetTransferKeyForEvaluationView(appState.fileTransferPendingViewName) === transferKey && appState.gates.viewChange.size === 2) {
                    helperResolveGatedViewChange(appState.fileTransferPendingViewName);
                }
            });
        });
    });

    // ===========================================
    // ===== HELPER ==============================
    // ===========================================
    function helperClientRegister(socket, data) {
        const payload = data ?? {};

        if (appState.shutdownScheduled) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because shutdown is scheduled");
            socket.disconnect(true);
            return;
        }

        const clientId = helperClientNormalizeId(payload.clientId);
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

        if (!helperClientCanAcceptNewIdentity(clientId)) {
            console.log("[Server] Rejecting client registration for " + clientId + " because two clients are already registered");
            socket.disconnect(true);
            return;
        }

        const clientsWereReady = helperClientCount() === 2;
        const existingClient = appState.clientsData.get(clientId);
        const clientSlot = existingClient ?? helperClientGetNextSlot();

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

        if (!clientsWereReady && helperClientCount() === 2) {
            helperClientEmitToAll("est-event:viewChangeResponse", { currentView: views.welcome });
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

    function helperClientNormalizeId(clientId) {
        if (typeof clientId !== "string") return null;

        const normalizedClientId = clientId.trim();
        return normalizedClientId.length > 0 ? normalizedClientId : null;
    }

    function helperClientCanAcceptNewIdentity(clientId) {
        return appState.clientsData.has(clientId) || helperClientCount() < 2;
    }

    function helperClientCount() {
        return appState.clientsData.size;
    }

    function helperClientGetNextSlot() {
        const usedClientIndexes = new Set();

        appState.clientsData.forEach((client) => {
            usedClientIndexes.add(client.clientIndex);
        });

        if (!usedClientIndexes.has(0)) return { clientIndex: 0, clientLabel: "a" };
        if (!usedClientIndexes.has(1)) return { clientIndex: 1, clientLabel: "b" };

        return null;
    }

    function helperClientGetBySocketId(socketId) {
        if (appState.shutdownScheduled) return null;

        const clientId = appState.clientsSocketRegistry.get(socketId);
        if (!clientId) return null;

        const client = appState.clientsData.get(clientId);
        if (!client || client.socketId !== socketId) return null;

        return client;
    }

    function helperClientGetPeerSocketId(socketId) {
        const thisClient = helperClientGetBySocketId(socketId);
        if (!thisClient) return null;

        for (const client of appState.clientsData.values()) {
            if (client.clientId !== thisClient.clientId) return client.socketId;
        }

        return null;
    }

    function helperClientCleanupSocketState(socketId) {
        appState.gates.viewChange.delete(socketId);
        appState.gates.coreStart.delete(socketId);
        appState.gates.coreStop.delete(socketId);

        for (const transferEntry of Array.from(appState.gates.fileTransfer)) {
            if (transferEntry.includes(":" + socketId + ":")) {
                appState.gates.fileTransfer.delete(transferEntry);
            }
        }
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

    function helperClientLogIgnoredEvent(socket, eventName, customReason) {
        const clientId = appState.clientsSocketRegistry.get(socket.id);
        const reason = customReason ?? (appState.shutdownScheduled ? "server shutdown is scheduled" : "socket is not an active registered client");

        console.log("[Server] Ignoring " + eventName + " from " + clientId + " (" + socket.id + ") " + "because" + " " + reason);
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

    function helperBuildViewFlow() {
        const testViews = [];

        if (enabledTests.sct) {
            testViews.push({ name: views.sctExp, passing: "gated", metadata: {} }, { name: views.sct, passing: "direct", metadata: {} }, { name: views.sctEval, passing: "gated", metadata: { testType: "sct" } });
        }
        if (enabledTests.lst) {
            testViews.push({ name: views.lstExp, passing: "gated", metadata: {} }, { name: views.lst, passing: "direct", metadata: {} }, { name: views.lstEval, passing: "gated", metadata: { testType: "lst" } });
        }
        if (testViews.length > 0) {
            testViews[0].metadata = { ...testViews[0].metadata, loopBehaviour: "start" };

            const loopEndView = [...testViews].reverse().find((view) => view.metadata?.testType);
            loopEndView.metadata = { ...loopEndView.metadata, loopBehaviour: "end" };
        }

        return [{ name: views.waiting, passing: "direct", metadata: {} }, { name: views.welcome, passing: "direct", metadata: {} }, { name: views.pretest, passing: "gated", metadata: {} }, ...testViews, ...(testViews.length > 0 ? [{ name: views.break, passing: "gated", metadata: { loopBehaviour: "break" } }] : []), { name: views.ending, passing: "direct", metadata: {} }];
    }

    function helperGetConditionDirName() {
        return String(appState.conditionIndex + 1).padStart(4, "0");
    }

    function helperGetConditionAssetName(clientNumber) {
        const conditionPadded = String(appState.conditionIndex + 1).padStart(2, "0");
        return "client_" + clientNumber + "/" + conditionPadded + ".png";
    }

    function helperSaveSessionFile(filename, data, useConditionSubdir = false) {
        const filePath = useConditionSubdir ? path.join(appState.sessionDir, helperGetConditionDirName(), filename) : path.join(appState.sessionDir, filename);
        fs.writeFileSync(filePath, data);
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

    function helperGateResolve(gateSet, key, threshold, onResolve) {
        gateSet.add(key);

        if (gateSet.size >= threshold) {
            onResolve();
            gateSet.clear();
        }
    }

    function helperGetTransferKeyForTestType(testType) {
        return helperGetConditionDirName() + ":" + testType + helperGetRoundSuffix(testType);
    }

    function helperGetTransferKeyForEvaluationView(currentViewName) {
        const view = viewFlow.find((v) => v.name === currentViewName);
        const testType = view?.metadata?.testType;
        return testType ? helperGetTransferKeyForTestType(testType) : null;
    }

    function helperIsWaitingForFileTransfers(currentViewName) {
        const transferKey = helperGetTransferKeyForEvaluationView(currentViewName);
        return transferKey !== null && !appState.fileTransferCompletedKeys.has(transferKey);
    }

    function helperAdvanceConditionIfNeeded(currentViewName, viewNext) {
        const view = viewFlow.find((v) => v.name === currentViewName);
        const isFirstLstEval = currentViewName === views.lstEval && appState.conditionListeningSpeakingTestIndex === 0;
        const isLoopEndView = view.metadata?.loopBehaviour === "end" && !isFirstLstEval;

        // When current view indicates a loop end: Increment conditionIndex
        if (isLoopEndView && viewNext !== views.ending) {
            appState.conditionIndex++;
        }
        // When next view indicates a loop start: Define shuffled condition order
        else if (viewNext === viewFlow.find((v) => v.metadata?.loopBehaviour === "start")?.name && appState.conditionIndex === 0) {
            helperSetConditionOrder();
        }
        // When neither applies: Early exit without logging condition change
        else {
            return isLoopEndView;
        }

        const currentCondition = helperGetCurrentCondition();
        console.log("[Server] Round " + appState.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
        helperSaveSessionFile("condition-settings.json", JSON.stringify(currentCondition, null, 4), true);

        return isLoopEndView;
    }

    function helperUpdateLstState(currentViewName, viewNext, isLoopEndView) {
        const isFirstLstEval = currentViewName === views.lstEval && appState.conditionListeningSpeakingTestIndex === 0;

        if (viewNext === views.lstExp) {
            appState.conditionListeningSpeakingTestIndex = 0;
        }
        if (isFirstLstEval) {
            appState.conditionListeningSpeakingTestIndex = 1;
        }
        if (isLoopEndView) {
            appState.conditionListeningSpeakingTestIndex = 0;
        }
    }

    function helperResolveGatedViewChange(currentViewName) {
        const viewNext = helperGetNextView(currentViewName);

        if (helperIsWaitingForFileTransfers(currentViewName)) {
            appState.fileTransferPendingViewName = currentViewName;
            return;
        }

        const isLoopEndView = helperAdvanceConditionIfNeeded(currentViewName, viewNext);
        helperUpdateLstState(currentViewName, viewNext, isLoopEndView);

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
                return viewFlow.find((v) => v.metadata?.loopBehaviour === "break").name;
            }
            else {
                return viewFlow.find((v) => v.metadata?.loopBehaviour === "start").name;
            }
        }

        // When current view indicates a break: Resume to the loop
        if (view.metadata?.loopBehaviour === "break") {
            return viewFlow.find((v) => v.metadata?.loopBehaviour === "start").name;
        }

        // When nothing applies, just continue with the next view
        return viewFlow[viewIndex + 1].name;
    }

    function helperSetConditionOrder() {
        const indices = estConfig.conditions.random.map((_, counter) => counter);
        for (let counter00 = indices.length - 1; counter00 > 0; counter00--) {
            const counter01 = Math.floor(Math.random() * (counter00 + 1));
            [indices[counter00], indices[counter01]] = [indices[counter01], indices[counter00]];
        }
        appState.conditionOrder = indices;
    }

    function helperGetCurrentCondition() {
        if (appState.conditionIndex === 0) {
            return estConfig.conditions.baseline[0];
        }
        return estConfig.conditions.random[appState.conditionOrder[appState.conditionIndex - 1]];
    }

    function helperGetRoundSuffix(testType) {
        if (testType !== "lst") return "";
        return "-r" + (appState.conditionListeningSpeakingTestIndex + 1);
    }

    function helperGetListeningSpeakingTestRole(clientSocketId) {
        const client = helperClientGetBySocketId(clientSocketId);
        if (!client) return null;

        if (appState.conditionListeningSpeakingTestIndex === 0) {
            return client.clientIndex === 0 ? "speaker" : "listener";
        }

        return client.clientIndex === 0 ? "listener" : "speaker";
    }

    function helperGetViewData(viewName, clientSocketId) {
        const isSct = viewName === views.sct;
        const isLst = viewName === views.lst;
        const isLstEvaluation = viewName === views.lstEval;

        if (isSct || isLst || isLstEvaluation) {
            const client = helperClientGetBySocketId(clientSocketId);
            if (!client) return { currentView: viewName };

            const clientNumber = client.clientIndex === 0 ? "01" : "02";
            const clientConditionAsset = helperGetConditionAssetName(clientNumber);

            const lstRole = isLst || isLstEvaluation ? helperGetListeningSpeakingTestRole(clientSocketId) : null;
            let conditionAsset = null;

            if (isSct) {
                conditionAsset = clientConditionAsset;
            }
            else if (isLst) {
                conditionAsset = lstRole === "speaker" ? clientConditionAsset : "listener.png";
            }

            const response = {
                currentView: viewName,
                conditionAsset: conditionAsset
            };

            if (isLst || isLstEvaluation) {
                response.conditionListeningSpeakingTestIndex = appState.conditionListeningSpeakingTestIndex;
                response.lstRole = lstRole;
            }

            return response;
        }

        return { currentView: viewName };
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
