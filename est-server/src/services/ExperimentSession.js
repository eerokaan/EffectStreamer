const { randomUUID } = require("node:crypto");
const { validateEnvelope, EVENTS } = require("@effectstreamer/common");
const { views } = require("../bootstraps/views.js");
const { ServerState } = require("./ServerState.js");
const { ClientRegistry } = require("./ClientRegistry.js");
const { SessionFiles } = require("./SessionFiles.js");
const { ViewFlow } = require("./ViewFlow.js");
const { ExperimentFlow } = require("./ExperimentFlow.js");
const { EffectStreamerCore } = require("./EffectStreamerCore.js");

class ExperimentSession extends ServerState {
    constructor({ participants, config, io, root, store, enrollments, onChange = () => {} }) {
        super();
        this.sessionId = randomUUID();
        this.config = config;
        this.store = store;
        this.revision = 0;
        this.attempts = [];
        this.outcome = null;
        this.phase = "experiment";
        this.actionQueue = Promise.resolve();
        this.onChange = onChange;
        this.lastRequests = new Map();
        participants.forEach((participant, index) => {
            this.clientsData.set(participant.participantId, {
                clientId: participant.participantId, participantId: participant.participantId,
                role: index === 0 ? "a" : "b", identity: participant.identity,
                ipAddress: participant.ipAddress, operatingSystem: participant.operatingSystem,
                socketId: null, currentView: views.welcome, viewData: {}, setupComplete: participant.setupComplete,
                pretestComplete: participant.pretestComplete
            });
        });
        this.sessionFiles = new SessionFiles({ state: this, config, root });
        this.sessionFiles.createFolderStructure();
        this.clientRegistry = new ClientRegistry({ state: this, io, views });
        this.viewFlow = new ViewFlow({ state: this, config });
        this.effectStreamerCore = new EffectStreamerCore({ state: this, config, clientRegistry: this.clientRegistry, sessionFiles: this.sessionFiles });
        this.experimentFlow = new ExperimentFlow({ state: this, config, views, viewFlow: this.viewFlow, clientRegistry: this.clientRegistry, sessionFiles: this.sessionFiles, effectStreamerCore: this.effectStreamerCore });
        this.effectStreamerCore.setRecordingContextCompletedHandler(context => this.experimentFlow.resolvePendingRecordingViewChanges(context));
        this.enrollments = enrollments;
    }

    snapshot(participantId) {
        const client = this.clientsData.get(participantId);
        if (!client) throw new Error("Unknown session participant");
        return {
            revision: this.revision, participantId, sessionId: this.sessionId, role: client.role,
            phase: this.phase, currentView: client.currentView,
            setupRequired: this.config.audioSetup.enabled, setupComplete: client.setupComplete,
            attemptId: this.recordingContextActive, viewData: client.viewData, outcome: this.outcome
        };
    }

    manifest() {
        return {
            sessionId: this.sessionId, revision: this.revision, phase: this.phase, outcome: this.outcome,
            conditionIndex: this.conditionIndex, conditionOrder: this.conditionOrder,
            conditionListeningSpeakingTestIndex: this.conditionListeningSpeakingTestIndex,
            participants: [...this.clientsData.values()].map(({ socketId, ...client }) => client),
            attempts: this.attempts, activeAttemptId: this.recordingContextActive,
            requiredAnswers: [...this.clientsData.values()].map(client => ({ participantId: client.participantId, pretestComplete: client.pretestComplete }))
        };
    }

    persist() { return this.store.save(this.manifest()); }

    publish() {
        this.revision++;
        for (const client of this.clientsData.values()) {
            if (client.socketId) this.clientRegistry.io.to(client.socketId).emit(EVENTS.snapshot, this.snapshot(client.participantId));
        }
        this.onChange(this);
    }

    dispatch(participantId, envelope) {
        const run = this.actionQueue.catch(() => {}).then(async () => {
            validateEnvelope(envelope);
            const client = this.clientsData.get(participantId);
            if (!client || envelope.participantId !== participantId || envelope.sessionId !== this.sessionId) throw new Error("Invalid participant/session scope");
            if (this.lastRequests.has(envelope.requestId)) {
                if (this.lastRequests.get(envelope.requestId) !== participantId) throw new Error("Request belongs to another participant");
                return this.snapshot(participantId);
            }
            if (envelope.type !== "recordingsFinalized" && envelope.attemptId !== this.recordingContextActive) throw new Error("Stale attempt scope");
            const payload = envelope.payload;
            const socket = { id: client.socketId };
            if (!socket.id) throw new Error("Participant is not connected");
            if (envelope.type === "setupComplete") {
                if (payload.inputUsable !== true || payload.playbackConfirmed !== true) throw new Error("Device test and playback confirmation required");
                if (this.recordingContextActive) throw new Error("Cannot change setup during an active attempt");
                client.setupComplete = true;
                this.enrollments.get(participantId).setupComplete = true;
                this.enrollments.save();
            }
            else if (envelope.type === "pretest") {
                if (client.currentView !== views.pretest || !payload.formData || typeof payload.formData !== "object" || Array.isArray(payload.formData)) throw new Error("Invalid pretest view/data");
                this.sessionFiles.saveFile("sessionDir", participantId + "-pretest-form.json", JSON.stringify(payload.formData, null, 4));
                client.pretestComplete = true;
                this.enrollments.get(participantId).pretestComplete = true;
                this.enrollments.save();
            }
            else if (["nextView", "ready", "submitRating", "stopCondition"].includes(envelope.type)) {
                if (payload.currentView !== client.currentView) throw new Error("Stale or invalid current view");
                if (this.config.audioSetup.enabled && !client.setupComplete) throw new Error("Audio setup required");
                this.experimentFlow.handleViewChangeRequest(socket, payload);
            }
            else if (envelope.type === "mediaPrepared") {
                this.effectStreamerCore.handleCoreStartResponse(socket, { ...payload, contextKey: envelope.attemptId });
            }
            else if (envelope.type === "mediaStopped") {
                this.effectStreamerCore.handleCoreStopResponse(socket, { ...payload, contextKey: envelope.attemptId });
            }
            else if (envelope.type === "recordingsFinalized") {
                if (!Array.isArray(payload.manifests) || payload.manifests.some(manifest => manifest.attemptId !== envelope.attemptId)) throw new Error("Invalid recording attempt scope");
                const manifests = await this.transfers.register({ participantId }, payload.manifests);
                this.clientRegistry.emitToSocket(client.socketId, EVENTS.recordingRequest, { recordingIds: manifests.map(manifest => manifest.recordingId), attemptId: envelope.attemptId });
            }
            else if (envelope.type === "mediaFailed") {
                const active = this.recordingContexts.get(this.recordingContextActive);
                if (active) { active.interrupted = true; this.effectStreamerCore.recordingContextStopCommit(active); }
                this.phase = "interrupted";
            }
            else if (envelope.type === "leave") {
                this.phase = "ended"; this.outcome = "partnerLeft";
                const active = this.recordingContexts.get(this.recordingContextActive);
                if (active) this.effectStreamerCore.recordingContextStopCommit(active);
            }
            else throw new Error("Action not available in this phase");
            this.lastRequests.set(envelope.requestId, participantId);
            if (this.lastRequests.size > 1024) this.lastRequests.delete(this.lastRequests.keys().next().value);
            await this.persist();
            this.publish();
            return this.snapshot(participantId);
        });
        this.actionQueue = run;
        return run;
    }

    dispose() {
        for (const context of this.recordingContexts.values()) clearTimeout(context.startupTimeout);
    }

    receivedRecording(manifest, receipt) {
        const run = this.actionQueue.catch(() => {}).then(async () => {
            const attempt = this.attempts.find(attempt => attempt.attemptId === manifest.attemptId);
            if (!attempt) throw new Error("Unknown recording attempt");
            attempt.receipts ||= [];
            if (!attempt.receipts.some(item => item.recordingId === receipt.recordingId)) attempt.receipts.push(receipt);
            const context = this.recordingContexts.get(manifest.attemptId);
            if (context) {
                if (manifest.status === "interrupted") context.interrupted = true;
                context.files.uploaded.add(manifest.participantId + ":" + manifest.track);
                this.effectStreamerCore.recordingContextFinalizeUpload(context);
            }
            await this.persist();this.publish();
        });
        this.actionQueue = run;
        return run;
    }
}
module.exports = { ExperimentSession };
