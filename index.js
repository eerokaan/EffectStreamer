// ===========================================
// ===== COMMON ==============================
// ===========================================
const estConfig = require("./est-config.json");

const http = require("http");
const express = require("express");
const socketIo = require("socket.io");
const os = require("os");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 100e6 // Support for max. 100 MB file transfers
});

const viewFlow = [
    { name: "viewWaiting", passing: "direct", metadata: {} },
    { name: "viewWelcome", passing: "direct", metadata: {} },
    { name: "viewPretest", passing: "gated", metadata: {} },
    { name: "viewShortConversationTestExplanation", passing: "gated", metadata: { loopBehaviour: "start" } },
    { name: "viewShortConversationTest", passing: "direct", metadata: {} },
    { name: "viewShortConversationTestEvaluation", passing: "gated", metadata: { testType: "sct" } },
    { name: "viewListeningSpeakingTestExplanation", passing: "gated", metadata: {} },
    { name: "viewListeningSpeakingTest", passing: "direct", metadata: {} },
    { name: "viewListeningSpeakingTestEvaluation", passing: "gated", metadata: { loopBehaviour: "end", testType: "lst" } },
    { name: "viewBreak", passing: "gated", metadata: { loopBehaviour: "break" } },
    { name: "viewEnding", passing: "direct", metadata: {} },
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
}

// ===========================================
// ===== WEBSOCKET LOGIC =====================
// ===========================================
io.on("connection", (socket) => {

    // ===== clientRegister ==============================
    socket.on("est-event:clientRegister", (data) => {
        console.log("Client registered: " + socket.id);
        appState.clients.set(socket.id, {
            operatingSystem: data.operatingSystem,
            ipAddress: data.ipAddress,
            deviceSource: data.deviceSource,
            deviceSink: data.deviceSink
        });

        // Check if two clients are connected now
        if (appState.clients.size === 2) {
            helperEmitToAll("est-event:viewChangeResponse", "viewWelcome");
        }
    });

    // ===== clientUnregister ==============================
    socket.on("est-event:clientUnregister", () => {
        console.log("Client disconnected: " + socket.id);
        appState.clients.delete(socket.id);
        appState.gates.viewChange.delete(socket.id);
        appState.gates.coreStart.delete(socket.id);

        // Check if less than two clients are connected now
        if (appState.clients.size < 2) {
            helperEmitToAll("est-event:viewChangeResponse", "viewWaiting");
        }
    });

    // ===== viewChangeRequest ==============================
    socket.on("est-event:viewChangeRequest", (data) => {
        const view = viewFlow.find(view => view.name === data.currentView);
        const viewNext = helperGetNextView(view.name);

        // Optional: Write scale data file if provided (for evaluation views)
        if (data.scaleValues) {
            const clientLabel = helperGetClientLabel(socket.id);
            const roundSuffix = helperGetRoundSuffix(view.metadata.testType);
            const serverFilename = "client-" + clientLabel + "-" + view.metadata.testType + roundSuffix + "-scales.json";
            const conditionPadded = String(appState.conditionIndex + 1).padStart(4, "0");
            const filePath = path.join(appState.sessionDir, conditionPadded, serverFilename);
            fs.writeFileSync(filePath, JSON.stringify(data.scaleValues, null, 2));
        }

        // Views with direct passing
        if (view.passing === "direct") {
            io.to(socket.id).emit("est-event:viewChangeResponse", helperGetViewChangeResponse(viewNext, socket.id));
        }

        // Views with gated passing (manual gate — helperGateResolve cannot be used due to deferred double-gate)
        else if (view.passing === "gated") {
            appState.gates.viewChange.add(socket.id);

            // Both clients now want to proceed
            if (appState.gates.viewChange.size === 2) {
                helperResolveGatedViewChange(view.name);
            }
        }
    });

    // ===== coreStartRequest ==============================
    socket.on("est-event:coreStartRequest", (data) => {
        const currentCondition = helperGetCurrentCondition();

        // Stage 1: Sender component (Direct response)
        if (data.component === "sender") {
            const peerClient = [...appState.clients].find(([id]) => id !== socket.id);
            const thisClient = appState.clients.get(socket.id);
            const estCoreSettings = {
                component: "sender",
                peerIp: peerClient[1].ipAddress,
                deviceSource: thisClient.deviceSource,
                latency: currentCondition.latency
            }
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
            helperEmitToAll("est-event:coreStopResponse", { testType: data.testType });
        });
    });

    // ===== fileTransferRequest ==============================
    socket.on("est-event:fileTransferRequest", (data) => {

        // Determine client label based on connection order
        const clientLabel = helperGetClientLabel(socket.id);

        // Construct filename: client-{a|b}-{sct|lst}-{microphone|headphones}.ogg
        const originalName = data.filename.replace(".ogg", "");
        const roundSuffix = helperGetRoundSuffix(data.testType);
        const transferStageKey = helperGetTransferStageKey(data.testType);
        const serverFilename = "client-" + clientLabel + "-" + data.testType + roundSuffix + "-" + originalName + ".ogg";

        // Write file to current condition directory
        const conditionPadded = String(appState.conditionIndex + 1).padStart(4, "0");
        const filePath = path.join(appState.sessionDir, conditionPadded, serverFilename);
        fs.writeFileSync(filePath, Buffer.from(data.fileData));

        // Gate: Track received files (2 files from 2 clients = 4 total)
        helperGateResolve(appState.gates.fileTransfer, transferStageKey + ":" + socket.id + ":" + data.filename, 4, () => {
            appState.evaluationLoopTransfersCompleted++;
            helperEmitToAll("est-event:fileTransferResponse");

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
function helperCreateFolderStructure() {
    const echostreamerDir = path.join(os.homedir(), "echostreamer");
    fs.mkdirSync(echostreamerDir, { recursive: true });

    // Determine next session number (n+1 from existing directories)
    const existing = fs.readdirSync(echostreamerDir).filter(name => /^\d{4}$/.test(name)).map(Number);
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

function helperGateResolve(gateSet, key, threshold, onResolve) {
    gateSet.add(key);

    if (gateSet.size >= threshold) {
        onResolve();
        gateSet.clear();
    }
}

function helperResolveGatedViewChange(currentViewName) {
    const view = viewFlow.find(view => view.name === currentViewName);
    const viewNext = helperGetNextView(currentViewName);
    const isFirstListeningSpeakingTestEvaluation = currentViewName === "viewListeningSpeakingTestEvaluation" && appState.lstRoundIndex === 0;
    const requiresFileTransfers = currentViewName === "viewListeningSpeakingTestEvaluation";
    const requiredTransferBatches = currentViewName === "viewListeningSpeakingTestEvaluation"
        ? (appState.lstRoundIndex === 0 ? 2 : 3)
        : 0;
    const isLoopEndView = view.metadata?.loopBehaviour === "end" && !isFirstListeningSpeakingTestEvaluation;

    // Double-gated: LST evaluation views also require all file transfer batches to be complete
    if (requiresFileTransfers) {
        if (appState.evaluationLoopTransfersCompleted < requiredTransferBatches) {
            appState.evaluationLoopPendingViewName = currentViewName;
            return;
        }
    }

    // When current view indicates a loop end: Increment conditionIndex
    if (isLoopEndView && viewNext !== "viewEnding") {
        appState.conditionIndex++;

        const currentCondition = helperGetCurrentCondition();
        console.log("Round " + appState.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
    }

    // When next view indicates a loop start: Define shuffled condition order using Fisher-Yates method
    else if (viewNext === viewFlow.find(view => view.metadata?.loopBehaviour === "start").name && appState.conditionIndex === 0) {
        helperSetConditionOrder();

        const currentCondition = helperGetCurrentCondition();
        console.log("Round " + appState.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
    }

    if (viewNext === "viewListeningSpeakingTestExplanation") {
        appState.lstRoundIndex = 0;
    }

    if (isFirstListeningSpeakingTestEvaluation) {
        appState.lstRoundIndex = 1;
    }

    helperEmitToAll("est-event:viewChangeResponse", (clientSocketId) => helperGetViewChangeResponse(viewNext, clientSocketId));
    appState.gates.viewChange.clear();

    // Reset file transfer tracking for the next condition
    if (isLoopEndView) {
        appState.evaluationLoopTransfersCompleted = 0;
        appState.lstRoundIndex = 0;
    }
    appState.evaluationLoopPendingViewName = null;
}

function helperGetNextView(currentView) {
    const viewIndex = viewFlow.findIndex(view => view.name === currentView);
    const view = viewFlow[viewIndex];

    if (currentView === "viewListeningSpeakingTestEvaluation" && appState.lstRoundIndex === 0) {
        return "viewListeningSpeakingTest";
    }

    // When current view indicates a loop end: Either exit (viewEnding), show break (viewBreak) or loop back
    if (view.metadata?.loopBehaviour === "end") {
        const roundsTotal = estConfig.conditions.baseline.length + estConfig.conditions.random.length;

        if (appState.conditionIndex >= roundsTotal - 1) {
            return "viewEnding";
        }
        else if (appState.conditionIndex + 1 === Math.floor(roundsTotal / 2)) {
            return viewFlow.find(view => view.metadata?.loopBehaviour === "break").name;
        }
        else {
            return viewFlow.find(view => view.metadata?.loopBehaviour === "start").name;
        }
    }

    // When current view indicates a break: Resume to the loop
    if (view.metadata?.loopBehaviour === "break") {
        return viewFlow.find(view => view.metadata?.loopBehaviour === "start").name;
    }

    // When nothing applies, just continue with the next view
    const viewNext = viewFlow[viewIndex + 1];
    return viewNext.name;
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
    const index = appState.conditionOrder[appState.conditionIndex - 1];
    return estConfig.conditions.random[index];
}

function helperGetClientIndex(clientSocketId) {
    return [...appState.clients.keys()].indexOf(clientSocketId);
}

function helperGetClientLabel(clientSocketId) {
    return helperGetClientIndex(clientSocketId) === 0 ? "a" : "b";
}

function helperGetRoundSuffix(testType) {
    if (testType !== "lst") {
        return "";
    }
    return "-r" + (appState.lstRoundIndex + 1);
}

function helperGetTransferStageKey(testType) {
    return testType + helperGetRoundSuffix(testType);
}

function helperGetListeningSpeakingTestRole(clientSocketId) {
    const clientIndex = helperGetClientIndex(clientSocketId);

    if (appState.lstRoundIndex === 0) {
        return clientIndex === 0 ? "speaker" : "listener";
    }
    
    return clientIndex === 0 ? "listener" : "speaker";
}

function helperGetViewChangeResponse(viewName, clientSocketId) {
    if (viewName === "viewShortConversationTest") {
        const clientIndex = helperGetClientIndex(clientSocketId);
        const clientNumber = clientIndex === 0 ? "01" : "02";
        const conditionPadded = String(appState.conditionIndex + 1).padStart(2, "0");

        return {
            viewName: viewName,
            conditionImage: "client_" + clientNumber + "/" + conditionPadded + ".png"
        };
    }

    if (viewName === "viewListeningSpeakingTest" || viewName === "viewListeningSpeakingTestEvaluation") {
        const conditionPadded = String(appState.conditionIndex + 1).padStart(2, "0");
        const participantRole = helperGetListeningSpeakingTestRole(clientSocketId);

        return {
            viewName: viewName,
            conditionImage: viewName === "viewListeningSpeakingTest" ? "client_" + (participantRole === "speaker" ? "01" : "02") + "/" + conditionPadded + ".png" : null,
            lstRoundIndex: appState.lstRoundIndex,
            participantRole: participantRole
        };
    }

    return viewName;
}

// ===========================================
// ===== HTTP SERVER LOGIC ===================
// ===========================================
server.listen(estConfig.server.port, estConfig.server.ipAddress, () => {
    helperCreateFolderStructure();
    console.log("Server is running on port " + estConfig.server.port);
});
