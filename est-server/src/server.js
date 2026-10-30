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
const { Prolific } = require("./services/Prolific.js");
const { AdmissionFlow } = require("./services/AdmissionFlow.js");
const { RecoveryPolicy } = require("./services/RecoveryPolicy.js");

function createCoordinator({ config, root = path.join(os.homedir(), "effectstreamer", "sessions") }) {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "64kb" }));
    const server = http.createServer(app);
    const io = new Server(server, { maxHttpBufferSize: 1048576, serveClient: false, pingInterval: 10000, pingTimeout: 10000 });
    const enrollments = new EnrollmentStore(root);
    const registry = new SessionRegistry({ config, io, root, enrollments });
    const transfers = new RecordingTransfers({ root, config: config.recordings, getSession: id => registry.getForParticipant(id), onReceipt: (session, manifest, receipt) => session.receivedRecording(manifest, receipt) });
    registry.transfers = transfers;
    const prolific = new Prolific({ config, enrollments, getSession: id => registry.getForParticipant(id) });
    registry.prolific = prolific;
    const admission = new AdmissionFlow({ config, enrollments, registry, prolific });
    registry.onChange = () => admission.match();
    const recovery = new RecoveryPolicy({ config, registry });registry.recovery = recovery;
    const ready = registry.store.loadAll().then(manifests => recovery.recoverAfterRestart(manifests));
    app.use(async (_request, response, next) => {try {await ready;next();} catch {response.status(503).json({ error: "Session recovery failed; operator intervention required" });}});
    registerEnrollmentRoutes(app, { config, enrollments, registry, prolific });
    registerRecordingRoutes(app, { config: config.recordings, enrollments, transfers });

    io.use(async (socket, next) => {
        try {await ready;} catch {return next(new Error("Session recovery failed"));}
        const participant = enrollments.authenticate(socket.handshake.auth?.reconnectToken);
        if (!participant) return next(new Error("Authentication required"));
        socket.data.participantId = participant.participantId; next();
    });
    io.on("connection", socket => {
        const participantId = socket.data.participantId;
        if (config.deployment.mode === "remote") admission.attach(socket, participantId);
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
        else if (config.deployment.mode === "local") socket.emit(EVENTS.snapshot, { revision: 0, participantId, sessionId: null, role: null, phase: "waiting", currentView: "viewWaiting", setupRequired: config.audioSetup.enabled, setupComplete: false, attemptId: null, viewData: {}, outcome: null });
        admission.match();

        const dispatch = async (envelope, acknowledge = () => {}) => {
            try {
                const current = registry.getForParticipant(participantId);
                if (!current && config.deployment.mode === "remote" && admission.connected.get(participantId) === socket) return acknowledge({ requestId: envelope?.requestId, ok: true, snapshot: await admission.dispatch(participantId, envelope) });
                if (!current || !current.clientRegistry.fetchClient(socket.id)) throw new Error("Not connected to an experiment session");
                acknowledge({ requestId: envelope?.requestId, ok: true, snapshot: await current.dispatch(participantId, envelope) });
            }
            catch (error) { acknowledge({ requestId: envelope?.requestId, ok: false, error: error.message }); }
        };
        socket.on(EVENTS.action, dispatch);
        socket.on(EVENTS.mediaResult, dispatch);
        socket.on(EVENTS.signal, async (envelope, acknowledge = () => {}) => {
            try {
                const current = registry.getForParticipant(participantId);
                if (!current?.clientRegistry.fetchClient(socket.id)) throw new Error("Not connected to an experiment session");
                acknowledge({ requestId: envelope?.requestId, ok: true, signal: await current.signal(participantId, envelope) });
            }
            catch (error) { acknowledge({ requestId: envelope?.requestId, ok: false, error: error.message }); }
        });
        socket.on("disconnect", () => {admission.detach(socket, participantId);registry.getForParticipant(participantId)?.clientRegistry.handleUnregister(socket);});
    });
    return {
        app, server, io, enrollments, registry, transfers, prolific, admission, recovery, ready,
        async close() {
            admission.close();
            recovery.close();await ready;
            await Promise.all([...registry.sessions.values()].map(session => session.dispose()));
            await new Promise(resolve => io.close(resolve));
            await Promise.all(registry.store.pending.values());
        }
    };
}
module.exports = { createCoordinator };
