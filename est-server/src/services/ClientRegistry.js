const net = require("net");
const { isObject } = require("../utils/validation.js");

class ClientRegistry {
    // prettier-ignore
    constructor({
        state,
        io,
        views
    }) {
        this.state = state;
        this.io = io;
        this.views = views;
        this.clientsReadyHandler = () => {};
    }

    setClientsReadyHandler(handler) {
        this.clientsReadyHandler = handler;
    }

    handleRegister(socket, data) {
        // Reject registrations while a shutdown is scheduled
        if (this.state.shutdownScheduled) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because shutdown is scheduled");
            socket.disconnect(true);
            return;
        }

        // Reject registrations with missing or invalid data
        if (!isObject(data)) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because data is missing or invalid");
            socket.disconnect(true);
            return;
        }

        // Reject registrations with a missing or invalid client ID
        const clientId = normalizeNonEmptyString(data.clientId);
        if (!clientId || !/^[A-Za-z0-9_-]+$/.test(clientId)) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because clientId is missing or invalid");
            socket.disconnect(true);
            return;
        }

        // Reject registrations with a missing or invalid IP address
        const ipAddress = normalizeNonEmptyString(data.ipAddress);
        if (!ipAddress || net.isIP(ipAddress) === 0) {
            console.log("[Server] Rejecting client registration for " + clientId + " because ipAddress is missing or invalid");
            socket.disconnect(true);
            return;
        }

        // Reject registrations with a missing or invalid operating system
        const operatingSystem = normalizeNonEmptyString(data.operatingSystem);
        if (!operatingSystem || !["linux", "windows"].includes(operatingSystem)) {
            console.log("[Server] Rejecting client registration for " + clientId + " because operatingSystem is missing or invalid");
            socket.disconnect(true);
            return;
        }

        // Reject sockets already mapped to a different client
        const mappedClientId = this.state.clientsSocketRegistry.get(socket.id);
        if (mappedClientId && mappedClientId !== clientId) {
            console.log("[Server] Rejecting client registration from socket " + socket.id + " because it is already mapped to client " + mappedClientId);
            socket.disconnect(true);
            return;
        }

        // Reject registrations beyond the two supported clients
        if (!this.state.clientsData.has(clientId) && this.state.clientsData.size >= 2) {
            console.log("[Server] Rejecting client registration for " + clientId + " because two clients are already registered");
            socket.disconnect(true);
            return;
        }

        // Determine the registration and session state
        const existingClient = this.state.clientsData.get(clientId);
        const clientReconnected = Boolean(existingClient && existingClient.socketId && existingClient.socketId !== socket.id);
        const startsExperimentSession = !existingClient && this.state.clientsData.size === 1;
        const restartsExperimentSession = existingClient && clientReconnected && this.state.clientsData.size === 2;

        // Support client session reconnections
        if (clientReconnected) {
            const oldSocketId = existingClient.socketId;
            this.cleanupRecordingContext(oldSocketId);
            this.state.clientsSocketRegistry.delete(oldSocketId);

            const oldSocket = this.io.sockets.sockets.get(oldSocketId);
            if (oldSocket) oldSocket.disconnect(true);

            console.log("[Server] Client reconnected: " + clientId);
        }
        else if (existingClient) {
            console.log("[Server] Client registration refreshed: " + clientId);
        }
        else {
            console.log("[Server] Client registered: " + clientId);
        }

        // Store the client data and socket mapping
        this.state.clientsData.set(clientId, {
            clientId,
            socketId: socket.id,
            operatingSystem,
            ipAddress
        });
        this.state.clientsSocketRegistry.set(socket.id, clientId);

        // Start the experiment session once both clients are registered
        if (startsExperimentSession || restartsExperimentSession) {
            this.clientsReadyHandler();
            this.emitToAll("est-event:viewChangeResponse", { currentView: this.views.welcome });
        }
    }

    handleUnregister(socket) {
        // Reject unregistrations from unknown sockets
        const clientId = this.state.clientsSocketRegistry.get(socket.id);
        if (!clientId) return;

        // Release the recording context and the socket mapping
        const client = this.state.clientsData.get(clientId);
        this.cleanupRecordingContext(socket.id);
        this.state.clientsSocketRegistry.delete(socket.id);

        // Reject unregistrations from sockets that no longer own the client
        if (!client || client.socketId !== socket.id) return;
        this.state.clientsData.delete(clientId);

        // Reject unregistrations while a shutdown is already scheduled
        if (this.state.shutdownScheduled) return;
        this.state.shutdownScheduled = true;

        // Stop the running core and move the clients to the waiting view
        console.log("[Server] Client disconnected: " + clientId);
        this.emitToAll("est-event:coreStopRequest", { testType: null, upload: false });
        this.emitToAll("est-event:viewChangeResponse", { currentView: this.views.waiting });

        // Shut down this server instance
        console.log("[Server] Shutting down current server instance due to client disconnect");
        setTimeout(() => process.exit(), 500);
    }

    emitToSocket(socketId, eventName, data) {
        if (data === undefined) this.io.to(socketId).emit(eventName);
        else this.io.to(socketId).emit(eventName, data);
    }

    emitToAll(eventName, data) {
        this.state.clientsData.forEach((clientData) => {
            this.emitToSocket(clientData.socketId, eventName, data);
        });
    }

    fetchClient(socketId) {
        if (this.state.shutdownScheduled) return null;

        const clientId = this.state.clientsSocketRegistry.get(socketId);
        if (!clientId) return null;

        const client = this.state.clientsData.get(clientId);
        if (!client || client.socketId !== socketId) return null;

        return client;
    }

    fetchPeerClient(client) {
        for (const registeredClient of this.state.clientsData.values()) {
            if (registeredClient.clientId !== client.clientId) return registeredClient;
        }

        return null;
    }

    cleanupRecordingContext(socketId) {
        this.state.gates.viewChange.delete(socketId);

        for (const recordingContext of this.state.recordingContexts.values()) {
            recordingContext.sockets.senderReady.delete(socketId);
            recordingContext.sockets.receiverReady.delete(socketId);
            recordingContext.sockets.stopped.delete(socketId);
            recordingContext.sockets.viewChangePending.delete(socketId);
        }
    }

    logEventError(socket, eventName, reason) {
        const clientId = this.state.clientsSocketRegistry.get(socket.id) ?? "unknown client";
        console.log("[Server] Ignoring " + eventName + " from " + clientId + ": " + reason);
    }
}

function normalizeNonEmptyString(value) {
    if (typeof value !== "string") return null;
    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
}

module.exports = { ClientRegistry };
