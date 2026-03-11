// ===========================================
// ===== COMMON ==============================
// ===========================================
const estConfig = require("./est-config.js");
const connectedClients = new Map();

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
    socket.on("est-event:clientRegister", (data) => {
        console.log("Client registered: " + socket.id, data);
        connectedClients.set(socket.id, data);

        // Check if two clients are connected now
        if (connectedClients.size === 2) {
            connectedClients.forEach((client, socketId) => {
                io.to(socketId).emit("est-event:sessionStart");
            });
        }
    });

    // clientUnregister
    socket.on("est-event:clientUnregister", (data) => {
        console.log("Client disconnected: " + socket.id);
        connectedClients.delete(socket.id);

        if (connectedClients.size < 2) {
            connectedClients.forEach((client, socketId) => {
                io.to(socketId).emit("est-event:sessionEnd");
            });
        }
    });
});

// ===========================================
// ===== HTTP SERVER LOGIC ===================
// ===========================================
server.listen(estConfig.server.port, () => {
    console.log("Server is running on port " + estConfig.server.port);
});
