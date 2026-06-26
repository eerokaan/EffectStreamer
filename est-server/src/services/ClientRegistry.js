class ClientRegistry {
    constructor({ state, io, views, onClientsReady = () => {} }) {
        this.state = state;
        this.io = io;
        this.views = views;
        this.onClientsReady = onClientsReady;
    }

    cleanupSocketState(socketId) {
        this.state.gates.viewChange.delete(socketId);
        this.state.gates.coreStart.delete(socketId);

        for (const transferEntry of Array.from(this.state.gates.fileTransfer)) {
            if (transferEntry.includes(":" + socketId + ":")) {
                this.state.gates.fileTransfer.delete(transferEntry);
            }
        }
    }

    disconnect(socket) {
        const clientId = this.state.clientsSocketRegistry.get(socket.id);
        if (!clientId) return;

        const client = this.state.clientsData.get(clientId);
        this.cleanupSocketState(socket.id);
        this.state.clientsSocketRegistry.delete(socket.id);

        if (!client || client.socketId !== socket.id) return;
        this.state.clientsData.delete(clientId);

        if (this.state.shutdownScheduled) return;
        this.state.shutdownScheduled = true;

        console.log("[Server] Client disconnected: " + clientId + " (" + socket.id + ")");
        this.emitToAll("est-event:coreStopResponse", { testType: null, upload: false });
        this.emitToAll("est-event:viewChangeResponse", { currentView: this.views.waiting });

        console.log("[Server] Shutting down current server instance due to client disconnect");
        setTimeout(() => process.exit(), 500);
    }

    emitToAll(eventName, dataOrFunction) {
        this.state.clientsData.forEach((clientData) => {
            const clientSocketId = clientData.socketId;

            if (dataOrFunction === undefined) {
                this.io.to(clientSocketId).emit(eventName);
            }
            else if (typeof dataOrFunction === "function") {
                this.io.to(clientSocketId).emit(eventName, dataOrFunction(clientSocketId, clientData));
            }
            else {
                this.io.to(clientSocketId).emit(eventName, dataOrFunction);
            }
        });
    }

    emitToSocket(socketId, eventName, data) {
        if (data === undefined) {
            this.io.to(socketId).emit(eventName);
        }
        else {
            this.io.to(socketId).emit(eventName, data);
        }
    }

    getBySocketId(socketId) {
        if (this.state.shutdownScheduled) return null;

        const clientId = this.state.clientsSocketRegistry.get(socketId);
        if (!clientId) return null;

        const client = this.state.clientsData.get(clientId);
        if (!client || client.socketId !== socketId) return null;

        return client;
    }

    logIgnoredEvent(socket, eventName, customReason) {
        const clientId = this.state.clientsSocketRegistry.get(socket.id);
        let reason = "n/a";

        if (this.state.shutdownScheduled) {
            reason = "Server shutdown is scheduled";
        }
        if (customReason) {
            reason = customReason;
        }

        const message = "[Server] Ignoring " + eventName + " from " + clientId + " (" + socket.id + "): " + reason;
        console.log(message);
    }

    register(socket, data) {
        const payload = data ?? {};

        if (this.state.shutdownScheduled) {
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

        const mappedClientId = this.state.clientsSocketRegistry.get(socket.id);
        if (mappedClientId && mappedClientId !== clientId) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because it is already mapped to client " + mappedClientId);
            socket.disconnect(true);
            return;
        }

        if (!this.state.clientsData.has(clientId) && this.state.clientsData.size >= 2) {
            console.log("[Server] Rejecting client registration for " + clientId + " because two clients are already registered");
            socket.disconnect(true);
            return;
        }

        const clientsWereReady = this.state.clientsData.size === 2;
        const existingClient = this.state.clientsData.get(clientId);
        const clientReconnected = Boolean(existingClient?.socketId && existingClient.socketId !== socket.id);
        let clientSlot = existingClient;

        if (!clientSlot) {
            const usedClientIndexes = new Set();
            this.state.clientsData.forEach((client) => {
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

        if (clientReconnected) {
            const oldSocketId = existingClient.socketId;
            this.cleanupSocketState(oldSocketId);
            this.state.clientsSocketRegistry.delete(oldSocketId);

            const oldSocket = this.io.sockets.sockets.get(oldSocketId);
            if (oldSocket) oldSocket.disconnect(true);

            console.log("[Server] Client reconnected: " + clientId + " (" + oldSocketId + " -> " + socket.id + ")");
        }
        else if (existingClient) {
            console.log("[Server] Client registration refreshed: " + clientId + " (" + socket.id + ")");
        }
        else {
            console.log("[Server] Client registered: " + clientId + " (" + socket.id + ")");
        }

        this.state.clientsData.set(clientId, {
            clientId,
            socketId: socket.id,
            clientIndex: clientSlot.clientIndex,
            clientLabel: clientSlot.clientLabel,
            operatingSystem: payload.operatingSystem,
            ipAddress: payload.ipAddress,
            deviceSource: payload.deviceSource,
            deviceSink: payload.deviceSink
        });
        this.state.clientsSocketRegistry.set(socket.id, clientId);

        if ((!clientsWereReady && this.state.clientsData.size === 2) || (clientsWereReady && clientReconnected)) {
            this.onClientsReady();
            this.emitToAll("est-event:viewChangeResponse", { currentView: this.views.welcome });
        }
    }
}

module.exports = { ClientRegistry };
