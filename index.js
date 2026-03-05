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
// ===== SOCKET CONNECTION ===================
// ===========================================
io.on("connection", (socket) => {

    // Handle registration
    socket.on("est-event:register", (data) => {
        console.log("Client registered: " + socket.id, data);

        // Add new client to map
        connectedClients.set(socket.id, data);

        // Check if two clients are connected now
        if (connectedClients.size === 2) {
            connectedClients.forEach((client, socketId) => {
                io.to(socketId).emit("est-event:allClientsConnected");
            });
        }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
        console.log("Client disconnected: " + socket.id);
        connectedClients.delete(socket.id);
    });
});

// ===========================================
// ===== HTTP SERVER =========================
// ===========================================
server.listen(estConfig.server.port, () => {
    console.log("Server is running on port " + estConfig.server.port);
});
