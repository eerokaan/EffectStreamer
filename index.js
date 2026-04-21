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
                console.log(`[Harness] Server instance killed by ${signal}. Exiting harness`);
                process.exit(0);
            }

            console.log(`[Harness] Server instance exited (code: ${code}). Restarting in 500ms`);
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

    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        maxHttpBufferSize: 1e7 // Support for max. 1 GB file transfers
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

    const viewFlow = [
        { name: views.waiting, passing: "direct", metadata: {} },
        { name: views.welcome, passing: "direct", metadata: {} },
        { name: views.pretest, passing: "gated", metadata: {} },
        {
            name: views.sctExp,
            passing: "gated",
            metadata: { loopBehaviour: "start" }
        },
        { name: views.sct, passing: "direct", metadata: {} },
        { name: views.sctEval, passing: "gated", metadata: { testType: "sct" } },
        { name: views.lstExp, passing: "gated", metadata: {} },
        { name: views.lst, passing: "direct", metadata: {} },
        {
            name: views.lstEval,
            passing: "gated",
            metadata: { loopBehaviour: "end", testType: "lst" }
        },
        { name: views.break, passing: "gated", metadata: { loopBehaviour: "break" } },
        { name: views.ending, passing: "direct", metadata: {} }
    ];

    let appState = {
        sessionDir: null,
        conditionIndex: 0,
        conditionOrder: [],
        lstRoundIndex: 0,
        evaluationLoopTransfersCompleted: 0,
        evaluationLoopPendingViewName: null,
        clients: new Map(),
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
        // ===== clientRegister ==============================
        socket.on("est-event:clientRegister", (data) => {
            console.log("[Server] Client registered: " + socket.id);

            const clientIndex = appState.clients.size;
            const clientLabel = clientIndex === 0 ? "a" : "b";

            appState.clients.set(socket.id, {
                clientIndex,
                clientLabel,
                operatingSystem: data.operatingSystem,
                ipAddress: data.ipAddress,
                deviceSource: data.deviceSource,
                deviceSink: data.deviceSink
            });

            // Check if two clients are connected now
            if (appState.clients.size === 2) {
                io.emit("est-event:viewChangeResponse", { currentView: views.welcome });
            }
        });

        // ===== clientUnregister ==============================
        socket.on("est-event:clientUnregister", () => {
            console.log("[Server] Client disconnected: " + socket.id);
            io.emit("est-event:viewChangeResponse", { currentView: views.waiting });

            console.log("[Server] Shutting down current server instance due to client disconnect");
            process.exit();
        });

        // ===== viewChangeRequest ==============================
        socket.on("est-event:viewChangeRequest", (data) => {
            const view = viewFlow.find((v) => v.name === data.currentView);
            const viewNext = helperGetNextView(view.name);
            const client = appState.clients.get(socket.id);

            // Optional: Write scale data file if provided (for evaluation views)
            if (data.scaleValues) {
                const roundSuffix = helperGetRoundSuffix(view.metadata.testType);
                const serverFilename = `client-${client.clientLabel}-${view.metadata.testType}${roundSuffix}-scales.json`;
                helperSaveSessionFile(serverFilename, JSON.stringify(data.scaleValues, null, 4), true);
            }

            // Views with direct passing
            if (view.passing === "direct") {
                io.to(socket.id).emit("est-event:viewChangeResponse", helperGetViewData(viewNext, socket.id));

                // On SCT and LST testing views: Notify partner that they were left in the room
                const peerSocketId = helperGetPeerSocketId(socket.id);
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
            const client = appState.clients.get(socket.id);
            const serverFilename = `client-${client.clientLabel}-pretest-form.json`;
            helperSaveSessionFile(serverFilename, JSON.stringify(data.formData, null, 4), false);

            io.to(socket.id).emit("est-event:pretestSubmitResponse");
        });

        // ===== coreStartRequest ==============================
        socket.on("est-event:coreStartRequest", (data) => {
            const currentCondition = helperGetCurrentCondition();

            // Stage 1: Sender component (Direct response)
            if (data.component === "sender") {
                const peerSocketId = helperGetPeerSocketId(socket.id);
                const peerClient = appState.clients.get(peerSocketId);
                const thisClient = appState.clients.get(socket.id);

                const estCoreSettings = {
                    component: "sender",
                    peerIp: peerClient?.ipAddress,
                    deviceSource: thisClient.deviceSource,
                    latency: currentCondition.latency
                };
                io.to(socket.id).emit("est-event:coreStartResponse", estCoreSettings);
            }

            // Stage 2: Receiver component (Gated response)
            else if (data.component === "receiver") {
                helperGateResolve(appState.gates.coreStart, socket.id, 2, () => {
                    helperEmitToAll("est-event:coreStartResponse", (clientSocketId, clientData) => ({
                        component: "receiver",
                        deviceSink: clientData.deviceSink,
                        gain: currentCondition.gain
                    }));
                });
            }
        });

        // ===== coreStopRequest ==============================
        socket.on("est-event:coreStopRequest", (data) => {
            helperGateResolve(appState.gates.coreStop, socket.id, 2, () => {
                io.emit("est-event:coreStopResponse", { testType: data.testType });
            });
        });

        // ===== fileTransferRequest ==============================
        socket.on("est-event:fileTransferRequest", (data) => {
            const client = appState.clients.get(socket.id);

            // Construct filename: client-{a|b}-{sct|lst}-{microphone|headphones}.ogg
            const originalName = data.filename.replace(".ogg", "");
            const roundSuffix = helperGetRoundSuffix(data.testType);
            const serverFilename = `client-${client.clientLabel}-${data.testType}${roundSuffix}-${originalName}.ogg`;

            // Write file to current condition directory
            helperSaveSessionFile(serverFilename, Buffer.from(data.fileData), true);

            // Gate: Track received files (2 files from 2 clients = 4 total)
            const transferStageKey = `${data.testType}${roundSuffix}`;
            helperGateResolve(appState.gates.fileTransfer, `${transferStageKey}:${socket.id}:${data.filename}`, 4, () => {
                appState.evaluationLoopTransfersCompleted++;
                io.emit("est-event:fileTransferResponse");

                // Try to resolve any pending double-gated view change
                if (appState.evaluationLoopPendingViewName && appState.gates.viewChange.size === 2) {
                    helperResolveGatedViewChange(appState.evaluationLoopPendingViewName);
                }
            });
        });
    });

    // ===========================================
    // ===== HELPER ==============================
    // ===========================================
    function helperResolveConfigPath() {
        const configName = "est-config.json";

        if (process.resourcesPath) {
            return path.join(process.resourcesPath, configName);
        }
        else {
            return path.join(__dirname, configName);
        }
    }

    function helperGetConditionDirName() {
        return String(appState.conditionIndex + 1).padStart(4, "0");
    }

    function helperGetConditionImageName(clientNumber) {
        const conditionPadded = String(appState.conditionIndex + 1).padStart(2, "0");
        return `client_${clientNumber}/${conditionPadded}.png`;
    }

    function helperSaveSessionFile(filename, data, useConditionSubdir = false) {
        const filePath = useConditionSubdir ? path.join(appState.sessionDir, helperGetConditionDirName(), filename) : path.join(appState.sessionDir, filename);
        fs.writeFileSync(filePath, data);
    }

    function helperCreateFolderStructure() {
        const echostreamerDir = path.join(os.homedir(), "echostreamer");
        fs.mkdirSync(echostreamerDir, { recursive: true });

        // Determine next session number (n+1 from existing directories)
        const existing = fs
            .readdirSync(echostreamerDir)
            .filter((name) => /^\d{4}$/.test(name))
            .map(Number);
        const sessionNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;

        appState.sessionDir = path.join(echostreamerDir, String(sessionNum).padStart(4, "0"));
        fs.mkdirSync(appState.sessionDir);

        // Create condition directories
        const roundsTotal = estConfig.conditions.baseline.length + estConfig.conditions.random.length;
        for (let counter = 1; counter <= roundsTotal; counter++) {
            fs.mkdirSync(path.join(appState.sessionDir, String(counter).padStart(4, "0")));
        }
    }

    function helperEmitToAll(eventName, dataOrFunction) {
        appState.clients.forEach((clientData, clientSocketId) => {
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

    function helperGetPeerSocketId(socketId) {
        for (const [id] of appState.clients) {
            if (id !== socketId) return id;
        }
        return null;
    }

    function helperGateResolve(gateSet, key, threshold, onResolve) {
        gateSet.add(key);

        if (gateSet.size >= threshold) {
            onResolve();
            gateSet.clear();
        }
    }

    function helperIsWaitingForFileTransfers(currentViewName) {
        const requiresFileTransfers = currentViewName === views.sctEval || currentViewName === views.lstEval;
        if (!requiresFileTransfers) return false;

        let requiredTransferBatches = 0;
        if (currentViewName === views.sctEval) {
            requiredTransferBatches = 1; // SCT finishes -> 1 batch
        }
        else if (currentViewName === views.lstEval) {
            // LST evaluation 1 finishes -> 2 batches (SCT + LST1)
            // LST evaluation 2 finishes -> 3 batches (SCT + LST1 + LST2)
            requiredTransferBatches = appState.lstRoundIndex === 0 ? 2 : 3;
        }

        return appState.evaluationLoopTransfersCompleted < requiredTransferBatches;
    }

    function helperAdvanceConditionIfNeeded(currentViewName, viewNext) {
        const view = viewFlow.find((v) => v.name === currentViewName);
        const isFirstLstEval = currentViewName === views.lstEval && appState.lstRoundIndex === 0;
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

        console.log(`[Server] Round ${appState.conditionIndex}: Using condition ${JSON.stringify(helperGetCurrentCondition())}`);
        return isLoopEndView;
    }

    function helperUpdateLstState(currentViewName, viewNext, isLoopEndView) {
        const isFirstLstEval = currentViewName === views.lstEval && appState.lstRoundIndex === 0;

        if (viewNext === views.lstExp) {
            appState.lstRoundIndex = 0;
        }
        if (isFirstLstEval) {
            appState.lstRoundIndex = 1;
        }
        if (isLoopEndView) {
            appState.evaluationLoopTransfersCompleted = 0;
            appState.lstRoundIndex = 0;
        }
    }

    function helperResolveGatedViewChange(currentViewName) {
        const viewNext = helperGetNextView(currentViewName);

        if (helperIsWaitingForFileTransfers(currentViewName)) {
            appState.evaluationLoopPendingViewName = currentViewName;
            return;
        }

        const isLoopEndView = helperAdvanceConditionIfNeeded(currentViewName, viewNext);
        helperUpdateLstState(currentViewName, viewNext, isLoopEndView);

        helperEmitToAll("est-event:viewChangeResponse", (clientSocketId) => helperGetViewData(viewNext, clientSocketId));
        appState.gates.viewChange.clear();
        appState.evaluationLoopPendingViewName = null;
    }

    function helperGetNextView(currentView) {
        const viewIndex = viewFlow.findIndex((view) => view.name === currentView);
        const view = viewFlow[viewIndex];

        if (currentView === views.lstEval && appState.lstRoundIndex === 0) {
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
        return "-r" + (appState.lstRoundIndex + 1);
    }

    function helperGetListeningSpeakingTestRole(clientSocketId) {
        const client = appState.clients.get(clientSocketId);

        if (appState.lstRoundIndex === 0) {
            return client.clientIndex === 0 ? "speaker" : "listener";
        }

        return client.clientIndex === 0 ? "listener" : "speaker";
    }

    function helperGetViewData(viewName, clientSocketId) {
        const isSct = viewName === views.sct;
        const isLst = viewName === views.lst;
        const isLstEvaluation = viewName === views.lstEval;

        if (isSct || isLst || isLstEvaluation) {
            const client = appState.clients.get(clientSocketId);
            const clientNumber = client.clientIndex === 0 ? "01" : "02";
            const clientConditionImage = helperGetConditionImageName(clientNumber);

            const lstRole = isLst || isLstEvaluation ? helperGetListeningSpeakingTestRole(clientSocketId) : null;
            let conditionImage = null;

            if (isSct) {
                conditionImage = clientConditionImage;
            }
            else if (isLst) {
                conditionImage = lstRole === "speaker" ? clientConditionImage : "listener.png";
            }

            const response = {
                currentView: viewName,
                conditionImage: conditionImage
            };

            if (isLst || isLstEvaluation) {
                response.lstRoundIndex = appState.lstRoundIndex;
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
        console.log(`[Server] Server started (PID: ${process.pid}). Running on port ${estConfig.server.port}.`);
    });
}
// ######################################################################################
// ##### MISSING EST_SERVER_TYPE ENVIRONMENT VAR ########################################
// ######################################################################################
else {
    console.error("You must specify the EST_SERVER_TYPE environment variable ('harness' or 'server')");
    process.exit(1);
}
