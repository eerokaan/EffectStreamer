// ===========================================
// ===== COMMON ==============================
// ===========================================
const estConfig = require("./est-config.json");

const http = require("http");
const express = require("express");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const viewFlow = [
    { name: "viewWaiting", passing: "direct", metadata: {} },
    { name: "viewWelcome", passing: "direct", metadata: {} },
    { name: "viewPretest", passing: "gated", metadata: {} },
    { name: "viewShortConversationTestExplanation", passing: "gated", metadata: { loopBehaviour: "start" } },
    { name: "viewShortConversationTest", passing: "direct", metadata: {} },
    { name: "viewShortConversationTestEvaluation", passing: "gated", metadata: {} },
    { name: "viewListeningSpeakingTestExplanation", passing: "gated", metadata: {} },
    { name: "viewListeningSpeakingTest", passing: "direct", metadata: {} },
    { name: "viewListeningSpeakingTestEvaluation", passing: "gated", metadata: { loopBehaviour: "end" } },
    { name: "viewBreak", passing: "gated", metadata: { loopBehaviour: "break" } },
    { name: "viewEnding", passing: "direct", metadata: {} },
];

let appState = {
    clientListConnected: new Map(),
    clientListWaitingOnViewChange: new Set(),
    clientListWaitingOnCoreStart: new Set(),
    conditionIndex: 0,
    conditionOrder: []
}

// ===========================================
// ===== WEBSOCKET LOGIC =====================
// ===========================================
io.on("connection", (socket) => {

    // ===== clientRegister ==============================
    socket.on("est-event:clientRegister", (data) => {
        console.log("Client registered: " + socket.id);
        appState.clientListConnected.set(socket.id, {
            operatingSystem: data.operatingSystem,
            ipAddress: data.ipAddress,
            deviceSource: data.deviceSource,
            deviceSink: data.deviceSink
        });

        // Check if two clients are connected now
        if (appState.clientListConnected.size === 2) {
            appState.clientListConnected.forEach((clientData, clientSocketId) => {
                io.to(clientSocketId).emit("est-event:viewChangeResponse", "viewWelcome");
            });
        }
    });

    // ===== clientUnregister ==============================
    socket.on("est-event:clientUnregister", () => {
        console.log("Client disconnected: " + socket.id);
        appState.clientListConnected.delete(socket.id);
        appState.clientListWaitingOnViewChange.delete(socket.id);
        appState.clientListWaitingOnCoreStart.delete(socket.id);

        // Check if less than two clients are connected now
        if (appState.clientListConnected.size < 2) {
            appState.clientListConnected.forEach((clientData, clientSocketId) => {
                io.to(clientSocketId).emit("est-event:viewChangeResponse", "viewWaiting");
            });
        }
    });

    // ===== viewChangeRequest ==============================
    socket.on("est-event:viewChangeRequest", (data) => {
        const view = viewFlow.find(view => view.name === data.currentView);
        const viewNext = helperGetNextView(view.name);

        // Views with direct passing
        if (view.passing === "direct") {
            io.to(socket.id).emit("est-event:viewChangeResponse", viewNext);
        }

        // Views with gated passing
        else if (view.passing === "gated") {
            appState.clientListWaitingOnViewChange.add(socket.id);

            // Both clients now want to proceed
            if (appState.clientListWaitingOnViewChange.size === 2) {

                // When current view indicates a loop end: Increment conditionIndex
                if (view.metadata?.loopBehaviour === "end" && viewNext !== "viewEnding") {
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

                // Push new view to clients
                appState.clientListWaitingOnViewChange.forEach(clientSocketId => {
                    io.to(clientSocketId).emit("est-event:viewChangeResponse", viewNext);
                });
                appState.clientListWaitingOnViewChange.clear();
            }
        }
    });

    // ===== coreStartRequest ==============================
    socket.on("est-event:coreStartRequest", (data) => {
        const currentCondition = helperGetCurrentCondition();

        // Stage 1: Sender component (Direct response)
        if (data.component === "sender") {
            const peerClient = [...appState.clientListConnected].find(([id]) => id !== socket.id);
            const thisClient = appState.clientListConnected.get(socket.id);
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
            appState.clientListWaitingOnCoreStart.add(socket.id);

            if (appState.clientListWaitingOnCoreStart.size === 2) {
                appState.clientListWaitingOnCoreStart.forEach(clientSocketId => {
                    const clientData = appState.clientListConnected.get(clientSocketId);
                    const estCoreSettings = {
                        component: "receiver",
                        deviceSink: clientData.deviceSink,
                        gain: currentCondition.gain
                    }
                    io.to(clientSocketId).emit("est-event:coreStartResponse", estCoreSettings);
                });
                appState.clientListWaitingOnCoreStart.clear();
            }
        }
    });

    // ===== coreStopRequest ==============================
    socket.on("est-event:coreStopRequest", () => {
        io.to(socket.id).emit("est-event:coreStopResponse");
    });
});

// ===========================================
// ===== HELPER ==============================
// ===========================================
function helperGetNextView(currentView) {
    const viewIndex = viewFlow.findIndex(view => view.name === currentView);
    const view = viewFlow[viewIndex];

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

// ===========================================
// ===== HTTP SERVER LOGIC ===================
// ===========================================
server.listen(estConfig.server.port, estConfig.server.ipAddress, () => {
    console.log("Server is running on port " + estConfig.server.port);
});
