const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { Server } = require("socket.io");
const { EVENTS } = require("@effectstreamer/common");
const { SessionRegistry } = require("./services/SessionRegistry.js");
const { EnrollmentStore } = require("./services/EnrollmentStore.js");
const { registerEnrollmentRoutes } = require("./routes/enrollment.js");
const { RecordingTransfers } = require("./services/RecordingTransfers.js");
const { registerRecordingRoutes } = require("./routes/recordings.js");

function createCoordinator({ config, root = path.join(os.homedir(), "effectstreamer", "sessions") }) {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "64kb" }));
    const server = http.createServer(app);
    const io = new Server(server, { maxHttpBufferSize: 1048576, serveClient: false });
    const enrollments = new EnrollmentStore(root);
    const registry = new SessionRegistry({ config, io, root, enrollments });
    const transfers = new RecordingTransfers({ root, config: config.recordings, getSession: id => registry.getForParticipant(id), onReceipt: (session, manifest, receipt) => session.receivedRecording(manifest, receipt) });
    registry.transfers = transfers;
    registerEnrollmentRoutes(app, { config, enrollments, registry });
    registerRecordingRoutes(app, { config: config.recordings, enrollments, transfers });

    io.use((socket, next) => {
        const participant = enrollments.authenticate(socket.handshake.auth?.reconnectToken);
        if (!participant) return next(new Error("Authentication required"));
        socket.data.participantId = participant.participantId; next();
    });
    io.on("connection", socket => {
        const participantId = socket.data.participantId;
        let session = registry.getForParticipant(participantId);
        if (!session && config.deployment.mode === "local") {
            const pair = ["client-a", "client-b"].map(identity => [...enrollments.participants.values()].find(participant => participant.identity === identity && !participant.sessionId));
            if (pair.every(Boolean)) session = registry.createPair(pair);
        }
        if (session) {
            // Pair formation can happen while the first participant is already waiting.
            for (const other of io.sockets.sockets.values()) {
                if (session.clientsData.has(other.data.participantId)) session.clientRegistry.attach(other, other.data.participantId);
            }
        }
        else socket.emit(EVENTS.snapshot, { revision: 0, participantId, sessionId: null, role: null, phase: "waiting", currentView: "viewWaiting", setupRequired: config.audioSetup.enabled, setupComplete: false, attemptId: null, viewData: {}, outcome: null });

        const dispatch = async (envelope, acknowledge = () => {}) => {
            try {
                const current = registry.getForParticipant(participantId);
                if (!current || !current.clientRegistry.fetchClient(socket.id)) throw new Error("Not connected to an experiment session");
                acknowledge({ requestId: envelope?.requestId, ok: true, snapshot: await current.dispatch(participantId, envelope) });
            }
            catch (error) { acknowledge({ requestId: envelope?.requestId, ok: false, error: error.message }); }
        };
        socket.on(EVENTS.action, dispatch);
        socket.on(EVENTS.mediaResult, dispatch);
        socket.on("disconnect", () => registry.getForParticipant(participantId)?.clientRegistry.handleUnregister(socket));
    });
    return {
        app, server, io, enrollments, registry, transfers,
        async close() {
            for (const session of registry.sessions.values()) session.dispose();
            await new Promise(resolve => io.close(resolve));
            await Promise.all(registry.store.pending.values());
        }
    };
}
module.exports = { createCoordinator };
