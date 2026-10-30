const { EVENTS } = require("@effectstreamer/common");

class LocalMediaAdapter {
    constructor(clientRegistry) { this.clientRegistry = clientRegistry; }
    async prepare({ session, attempt, condition, component }) {
        for (const client of session.clientsData.values()) {
            const peer = this.clientRegistry.fetchPeerClient(client);
            this.clientRegistry.emitToSocket(client.socketId, EVENTS.mediaCommand, {
                type: "prepareCore", attemptId: attempt.contextKey, component, condition,
                peer: { ipAddress: peer.ipAddress, port: peer.ports?.listen ?? 9004 }, ports: client.ports
            });
        }
    }
    async start({ attempt }) { this.clientRegistry.emitToAll(EVENTS.mediaCommand, { type: "startAudio", attemptId: attempt.contextKey }); }
    async stop({ attempt, reason }) { this.clientRegistry.emitToAll(EVENTS.mediaCommand, { type: "stopCore", attemptId: attempt.contextKey, reason }); }
    async dispose() {}
}
module.exports = { LocalMediaAdapter };
