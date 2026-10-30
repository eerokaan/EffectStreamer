class ClientRegistry {
    constructor({ state, io, views }) {
        this.state = state; this.io = io; this.views = views;
    }

    attach(socket, participantId) {
        const client = this.state.clientsData.get(participantId);
        if (!client) throw new Error("Not a session participant");
        const oldSocketId = client.socketId;
        if (oldSocketId && oldSocketId !== socket.id) this.state.clientsSocketRegistry.delete(oldSocketId);
        client.socketId = socket.id;
        this.state.clientsSocketRegistry.set(socket.id, participantId);
        socket.join(this.state.sessionId);
        if (oldSocketId && oldSocketId !== socket.id) this.io.sockets.sockets.get(oldSocketId)?.disconnect(true);
        this.state.publish();
    }

    handleUnregister(socket) {
        const client = this.fetchClient(socket.id);
        this.state.clientsSocketRegistry.delete(socket.id);
        if (!client) return;
        client.socketId = null;
        if (this.state.disposed) return;
        if (this.state.recoveryPolicy) {
            void this.state.recoveryPolicy.disconnected(client.participantId, "socket").catch(error => {this.state.persistenceError = error;});return;
        }
        const active = this.state.recordingContexts.get(this.state.recordingContextActive);
        if (active) {
            active.interrupted = true;
            this.state.phase = "interrupted";
            this.state.effectStreamerCore.recordingContextStopCommit(active);
        }
        this.state.publish();
        void this.state.persist().catch(error => {this.state.persistenceError = error;});
    }

    emitToSocket(socketId, eventName, data) {
        if (!socketId) return;
        const client = this.fetchClient(socketId);
        if (eventName === "est-event:viewChangeResponse" && client && data?.currentView) {
            client.currentView = data.currentView;
            client.viewData = data;
        }
        else if (eventName === "est-event:viewChangeResponse" && client && data?.showDialog) client.viewData = { ...client.viewData, showDialog: true };
        const scoped = data && typeof data === "object" ? { ...data, sessionId: this.state.sessionId, attemptId: data.attemptId ?? this.state.recordingContextActive, participantId: client?.participantId } : data;
        this.io.to(socketId).emit(eventName, scoped);
    }

    emitToAll(eventName, data) {
        for (const client of this.state.clientsData.values()) this.emitToSocket(client.socketId, eventName, data);
    }

    fetchClient(socketId) {
        const id = this.state.clientsSocketRegistry.get(socketId);
        const client = this.state.clientsData.get(id);
        return client?.socketId === socketId ? client : null;
    }

    fetchPeerClient(client) { return [...this.state.clientsData.values()].find(other => other.participantId !== client.participantId) || null; }

    logEventError(socket, eventName, reason) { console.warn("[Session " + this.state.sessionId + "] Ignoring " + eventName + " from " + socket.id + ": " + reason); }
}
module.exports = { ClientRegistry };
