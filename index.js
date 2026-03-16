// ===========================================
// ===== COMMON ==============================
// ===========================================
const estConfig = require("./est-config.js");
const clientListConnected = new Set();
const clientListWaiting = new Set();

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

// ===========================================
// ===== WEBSOCKET LOGIC =====================
// ===========================================
io.on("connection", (socket) => {

    // clientRegister
    socket.on("est-event:clientRegister", () => {
        console.log("Client registered: " + socket.id);
        clientListConnected.add(socket.id);

        // Check if two clients are connected now
        if (clientListConnected.size === 2) {
            clientListConnected.forEach(clientSocketId => {
                io.to(clientSocketId).emit("est-event:viewChangeResponse", "viewWelcome");
            });
        }
    });

    // clientUnregister
    socket.on("est-event:clientUnregister", () => {
        console.log("Client disconnected: " + socket.id);
        clientListConnected.delete(socket.id);
        clientListWaiting.delete(socket.id);

        // Check if less than two clients are connected now
        if (clientListConnected.size < 2) {
            clientListConnected.forEach(clientSocketId => {
                io.to(clientSocketId).emit("est-event:viewChangeResponse", "viewWaiting");
            });
        }
    });

    // viewChangeRequest
    socket.on("est-event:viewChangeRequest", (data) => {
        const viewsPassDirect = [
            "viewWelcome",
            "viewShortConversationTest",
            "viewListeningSpeakingTest",
            "viewBreak",
            "viewEnding"
        ];
        const viewsPassGated = [
            "viewPretest",
            "viewShortConversationTestExplanation",
            "viewShortConversationTestEvaluation",
            "viewListeningSpeakingTestExplanation",
            "viewListeningSpeakingTestEvaluation"
        ];

        // Direct pass views
        if (viewsPassDirect.includes(data.currentView)) {
            io.to(socket.id).emit("est-event:viewChangeResponse", helperNextViewLookup(data.currentView));
        }

        // Gated pass views
        else if (viewsPassGated.includes(data.currentView)) {
            clientListWaiting.add(socket.id);

            if (clientListWaiting.size === 2) {
                clientListWaiting.forEach(clientSocketId => {
                    io.to(clientSocketId).emit("est-event:viewChangeResponse", helperNextViewLookup(data.currentView));
                });
                clientListWaiting.clear();
            }
        }
    });
});

// ===========================================
// ===== HELPER ==============================
// ===========================================
function helperNextViewLookup(currentView) {
    const viewMap = {
        "viewWaiting": "viewWelcome",
        "viewWelcome": "viewPretest",
        "viewPretest": "viewShortConversationTestExplanation",
        "viewShortConversationTestExplanation": "viewShortConversationTest",
        "viewShortConversationTest": "viewShortConversationTestEvaluation",
        "viewShortConversationTestEvaluation": "viewListeningSpeakingTestExplanation",
        "viewListeningSpeakingTestExplanation": "viewListeningSpeakingTest",
        "viewListeningSpeakingTest": "viewListeningSpeakingTestEvaluation",
        "viewListeningSpeakingTestEvaluation": "viewBreak",
        "viewBreak": "viewEnding",
        "viewEnding": "viewWelcome"
    };
    return viewMap[currentView];
}

// ===========================================
// ===== HTTP SERVER LOGIC ===================
// ===========================================
server.listen(estConfig.server.port, () => {
    console.log("Server is running on port " + estConfig.server.port);
});
