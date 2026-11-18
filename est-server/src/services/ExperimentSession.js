const { randomUUID, createHash } = require("node:crypto");
const { validateEnvelope, EVENTS } = require("@effectstreamer/common");
const { views } = require("../bootstraps/views.js");
const { ServerState } = require("./ServerState.js");
const { ClientRegistry } = require("./ClientRegistry.js");
const { SessionFiles } = require("./SessionFiles.js");
const { ViewFlow } = require("./ViewFlow.js");
const { ExperimentFlow } = require("./ExperimentFlow.js");
const { EffectStreamerCore } = require("./EffectStreamerCore.js");
const { LocalMediaAdapter } = require("../media/LocalMediaAdapter.js");
const { RemoteMediaAdapter } = require("../media/RemoteMediaAdapter.js");
const { validatePretestAnswers, validateRating } = require("./ParticipantResponses.js");
const { getRoundSuffix, getExperimentCondition } = require("../utils/experiment.js");
const { createShuffledIndices } = require("../utils/random.js");

class ExperimentSession extends ServerState {
    constructor({ participants, config, io, root, store, enrollments, allocator, restored, onChange = () => {} }) {
        super();
        this.sessionId = restored?.sessionId || randomUUID();
        this.config = config;
        // Recovery may end an incompatible session. Keep the original study metadata on disk,
        // including the absence of a language in manifests from before it was recorded.
        this.sessionLanguage = restored ? restored.sessionLanguage : config.sessionLanguage;
        this.sessionConfigurationHash = restored ? restored.configurationHash : this.configurationHash();
        this.store = store;
        this.revision = 0;
        this.attempts = [];
        this.outcome = null;
        this.phase = "experiment";
        this.actionQueue = Promise.resolve();
        this.onChange = onChange;
        this.lastRequests = new Map();
        this.mediaOperations = new Set();this.retryCounts = {};
        participants.forEach((participant, index) => {
            this.clientsData.set(participant.participantId, {
                clientId: participant.participantId, participantId: participant.participantId,
                role: index === 0 ? "a" : "b", identity: participant.identity, recruitment: participant.recruitment,
                ipAddress: participant.ipAddress, operatingSystem: participant.operatingSystem,
                socketId: null, currentView: views.welcome, viewData: {}, setupComplete: participant.setupComplete,
                pretestComplete: participant.pretestComplete
            });
        });
        this.sessionFiles = new SessionFiles({ state: this, config, root });
        this.sessionFiles.createFolderStructure({ restore: Boolean(restored) });
        this.clientRegistry = new ClientRegistry({ state: this, io, views });
        this.mediaAdapter = config.deployment.mode === "remote" ? new RemoteMediaAdapter({ config: config.remote, allocator, clientRegistry: this.clientRegistry, onFailure: error => this.mediaFailure(error) }) : new LocalMediaAdapter(this.clientRegistry);
        this.viewFlow = new ViewFlow({ state: this, config });
        this.effectStreamerCore = new EffectStreamerCore({ state: this, config, clientRegistry: this.clientRegistry, sessionFiles: this.sessionFiles });
        this.experimentFlow = new ExperimentFlow({ state: this, config, views, viewFlow: this.viewFlow, clientRegistry: this.clientRegistry, sessionFiles: this.sessionFiles, effectStreamerCore: this.effectStreamerCore });
        this.effectStreamerCore.setRecordingContextCompletedHandler(context => this.experimentFlow.resolvePendingRecordingViewChanges(context));
        this.enrollments = enrollments;
        if (!restored && config.deployment.mode === "remote" && participants.every(person => person.readyOrder != null && person.pretestComplete && person.setupComplete)) {
            this.conditionOrder = createShuffledIndices(config.conditions.random.length);
            this.sessionFiles.saveFile("conditionDir", "condition-settings.json", JSON.stringify(getExperimentCondition(config, 0, this.conditionOrder), null, 4));
            const first = this.viewFlow.getNextView(this.viewFlow.getViewByName(views.pretest));
            for (const client of this.clientsData.values()) {
                client.currentView = first.name;client.viewData = this.viewFlow.getViewData(first, client);
                this.sessionFiles.saveFile("sessionDir", client.participantId + "-pretest-form.json", JSON.stringify(enrollments.get(client.participantId).formData, null, 4));
            }
        }
        if (restored) {
            for (const key of ["revision", "phase", "outcome", "conditionIndex", "conditionOrder", "conditionListeningSpeakingTestIndex", "attempts", "recovery", "retryCounts"]) if (restored[key] !== undefined) this[key] = structuredClone(restored[key]);
            this.clientsData = new Map(restored.participants.map(client => [client.participantId, { ...client, socketId: null }]));
            this.recordingContextActive = restored.activeAttemptId;
            this.gates.viewChange = new Set(restored.viewGate || []);
            if (restored.activeContext) {
                const saved = restored.activeContext;
                this.recordingContexts.set(saved.contextKey, { ...saved, clients: [...this.clientsData.values()], sockets: Object.fromEntries(Object.entries(saved.sockets).map(([key, values]) => [key, new Set(values)])), files: { uploaded: new Set(saved.files.uploaded), failed: new Set() } });
            }
        }
    }

    snapshot(participantId) {
        const client = this.clientsData.get(participantId);
        if (!client) throw new Error("Unknown session participant");
        return {
            revision: this.revision, participantId, sessionId: this.sessionId, role: client.role,
            phase: this.phase, currentView: this.phase === "interrupted" ? "viewInterrupted" : client.currentView,
            setupRequired: this.config.audioSetup, setupComplete: client.setupComplete,
            attemptId: this.recordingContextActive, viewData: { ...client.viewData, recordingStatus: this.recordingContexts.get(this.recordingContextActive)?.status ?? null, recovery: this.recovery, completion: this.prolific?.previewCompletion(participantId) || null }, outcome: this.outcome
        };
    }

    manifest() {
        const active = this.recordingContexts.get(this.recordingContextActive);
        return {
            sessionId: this.sessionId, sessionLanguage: this.sessionLanguage, revision: this.revision, phase: this.phase, outcome: this.outcome,
            conditionIndex: this.conditionIndex, conditionOrder: this.conditionOrder,
            conditionListeningSpeakingTestIndex: this.conditionListeningSpeakingTestIndex,
            participants: [...this.clientsData.values()].map(({ socketId, ...client }) => client),
            attempts: this.attempts, activeAttemptId: this.recordingContextActive,
            recovery: this.recovery, retryCounts: this.retryCounts, configurationHash: this.sessionConfigurationHash, viewGate: [...this.gates.viewChange],
            activeContext: active ? { contextKey: active.contextKey, status: active.status, scope: active.scope, interrupted: active.interrupted, workerStopped: active.workerStopped, sockets: Object.fromEntries(Object.entries(active.sockets).map(([key, values]) => [key, [...values]])), files: { uploaded: [...active.files.uploaded] } } : null,
            requiredAnswers: [...this.clientsData.values()].map(client => ({ participantId: client.participantId, pretestComplete: client.pretestComplete }))
        };
    }

    persist() { return this.store.save(this.manifest()); }
    configurationHash() {return createHash("sha256").update(JSON.stringify({ mode: this.config.deployment.mode, sessionLanguage: this.config.sessionLanguage, tests: this.config.tests, conditions: this.config.conditions, pretestForm: this.config.pretestForm })).digest("hex");}

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
            if (!["recordingsFinalized", "resume"].includes(envelope.type) && envelope.attemptId !== this.recordingContextActive) throw new Error("Stale attempt scope");
            const payload = envelope.payload;
            if (this.config.deployment.mode === "remote" && ["mediaPrepared", "mediaStarted", "mediaStopped", "mediaFailed"].includes(envelope.type) && payload.generation !== this.mediaAdapter.generation) throw new Error("Stale media generation");
            const socket = { id: client.socketId };
            if (!socket.id) throw new Error("Participant is not connected");
            if (envelope.type === "resume") {
                await this.recoveryPolicy.resumed(participantId, payload);
            }
            else if (envelope.type === "ready" && this.recovery) {
                await this.recoveryPolicy.reconnected(participantId, { ready: true });
            }
            else if (envelope.type === "setupInvalidated") {
                if (this.phase !== "ended") {
                    client.setupComplete = false;this.enrollments.get(participantId).setupComplete = false;
                    this.enrollments.save();this.gates.viewChange.clear();
                    const context = this.recordingContexts.get(this.recordingContextActive);
                    if (context && ["startingSender", "startingReceiver", "startingMedia", "running"].includes(context.status)) await this.recoveryPolicy.disconnected(participantId, "media");
                }
            }
            else if (envelope.type === "setupComplete") {
                if (payload.inputUsable !== true || payload.playbackConfirmed !== true) throw new Error("Device test and playback confirmation required");
                if (this.recordingContextActive && !this.recovery) throw new Error("Cannot change setup during an active attempt");
                client.setupComplete = true;
                this.enrollments.get(participantId).setupComplete = true;
                this.enrollments.save();
            }
            else if (envelope.type === "pretest") {
                if (client.currentView !== views.pretest || !payload.formData || typeof payload.formData !== "object" || Array.isArray(payload.formData)) throw new Error("Invalid pretest view/data");
                const answers = validatePretestAnswers(this.config.pretestForm, payload.formData);
                this.sessionFiles.saveFile("sessionDir", participantId + "-pretest-form.json", JSON.stringify(answers, null, 4));
                client.pretestComplete = true;
                this.enrollments.get(participantId).pretestComplete = true;
                this.enrollments.save();
            }
            else if (["nextView", "ready", "submitRating", "stopCondition"].includes(envelope.type)) {
                if (this.phase === "interrupted" || this.phase === "ended") throw new Error("Session is not accepting experiment actions");
                if (payload.currentView !== client.currentView) throw new Error("Stale or invalid current view");
                if (this.config.audioSetup && !client.setupComplete) throw new Error("Audio setup required");
                if (client.currentView === views.pretest && !client.pretestComplete) throw new Error("Required pretest answers missing");
                if ([views.sctEval, views.lstEval].includes(client.currentView)) {
                    const testType = client.currentView === views.sctEval ? "sct" : "lst";
                    const roundSuffix = getRoundSuffix(testType, this.conditionListeningSpeakingTestIndex);
                    const attempt = [...this.attempts].reverse().find(attempt => attempt.conditionIndex === this.conditionIndex && attempt.testType === testType && attempt.roundSuffix === roundSuffix && attempt.status === "completed");
                    if (!attempt) throw new Error("Recording attempt has not completed");
                    const role = (client.role === "a") === (this.conditionListeningSpeakingTestIndex === 0) ? "speaker" : "listener";
                    const values = validateRating(payload.scaleValues, { testType, role });
                    attempt.answers ||= [];
                    if (!attempt.answers.some(answer => answer.participantId === participantId)) attempt.answers.push({ participantId, values });
                }
                this.experimentFlow.handleViewChangeRequest(socket, payload);
            }
            else if (envelope.type === "mediaPrepared") {
                this.effectStreamerCore.handleMediaPrepared(socket, { ...payload, contextKey: envelope.attemptId });
            }
            else if (envelope.type === "mediaStopped") {
                this.effectStreamerCore.handleMediaStopped(socket, { ...payload, contextKey: envelope.attemptId });
            }
            else if (envelope.type === "mediaStarted") {
                try { await this.effectStreamerCore.handleMediaStarted(socket, { ...payload, contextKey: envelope.attemptId }); }
                catch (error) { this.mediaFailure(error); throw error; }
            }
            else if (envelope.type === "recordingsFinalized") {
                if (!Array.isArray(payload.manifests) || payload.manifests.some(manifest => manifest.attemptId !== envelope.attemptId)) throw new Error("Invalid recording attempt scope");
                const manifests = await this.transfers.register({ participantId }, payload.manifests);
                this.clientRegistry.emitToSocket(client.socketId, EVENTS.recordingRequest, { recordingIds: manifests.map(manifest => manifest.recordingId), attemptId: envelope.attemptId });
                if (this.recovery) await this.recoveryPolicy.resumed(participantId, { manifests, mediaPresent: false }, { registered: true });
            }
            else if (envelope.type === "mediaFailed") {
                await this.recoveryPolicy.disconnected(participantId, "media");
            }
            else if (envelope.type === "leave") {
                await this.recoveryPolicy.end(this, "partnerLeft");
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

    async dispose() {
        this.disposed = true;
        for (const context of this.recordingContexts.values()) {clearTimeout(context.startupTimeout);clearTimeout(context.conditionTimeout);}
        await this.mediaAdapter.dispose();await Promise.allSettled(this.mediaOperations);
    }

    runMedia(operation) {
        if (this.disposed) return;
        const pending = Promise.resolve().then(operation).then(() => this.disposed ? null : this.persist()).then(() => {if (!this.disposed) this.publish();}).catch(error => this.mediaFailure(error));
        this.mediaOperations.add(pending);void pending.finally(() => this.mediaOperations.delete(pending));
    }

    mediaFailure(error) {
        if (this.disposed) return;
        if (this.recoveryPolicy) {
            const participantId = this.clientsData.keys().next().value;
            void this.recoveryPolicy.disconnected(participantId, "worker").catch(failure => {this.persistenceError = failure;});
            console.warn("[Session " + this.sessionId + "] Media failure: " + error.message);return;
        }
        const active = this.recordingContexts.get(this.recordingContextActive);
        if (!active || active.status === "completed") return;
        active.interrupted = true;
        this.phase = "interrupted";
        this.attempts.find(attempt => attempt.attemptId === active.contextKey).status = "interrupted";
        this.effectStreamerCore.recordingContextStopCommit(active);
        this.publish();
        void this.persist().catch(failure => { this.persistenceError = failure; });
        console.warn("[Session " + this.sessionId + "] Media failure: " + error.message);
    }

    signal(participantId, envelope) {
        validateEnvelope(envelope);
        if (envelope.type !== "signal" || envelope.participantId !== participantId || envelope.sessionId !== this.sessionId || envelope.attemptId !== this.recordingContextActive) return Promise.reject(new Error("Invalid signaling scope"));
        if (this.config.deployment.mode !== "remote") return Promise.reject(new Error("WebRTC signaling is not available locally"));
        return this.mediaAdapter.signal(participantId, { ...envelope.payload, sessionId: this.sessionId, attemptId: envelope.attemptId });
    }

    completionReady() {
        if ([...this.clientsData.values()].some(client => !client.pretestComplete || (this.config.audioSetup && !client.setupComplete))) return false;
        const count = this.config.conditions.baseline.length + this.config.conditions.random.length;
        for (let conditionIndex = 0; conditionIndex < count; conditionIndex++) {
            const rounds = [...(this.config.tests.sct ? [["sct", ""]] : []), ...(this.config.tests.lst ? [["lst", "-r1"], ["lst", "-r2"]] : [])];
            for (const [testType, roundSuffix] of rounds) {
                const attempt = this.attempts.find(attempt => attempt.conditionIndex === conditionIndex && attempt.testType === testType && attempt.roundSuffix === roundSuffix && attempt.status === "completed");
                if (!attempt) return false;
                for (const participantId of this.clientsData.keys()) {
                    const answer = attempt.answers?.find(answer => answer.participantId === participantId);
                    if (!answer) return false;
                    const client = this.clientsData.get(participantId);
                    const role = (client.role === "a") === (roundSuffix === "-r1") ? "speaker" : "listener";
                    try {validateRating(answer.values, { testType, role });} catch {return false;}
                    for (const track of ["microphone", "headphones"]) {
                        const manifest = attempt.recordings?.find(manifest => manifest.participantId === participantId && manifest.track === track && manifest.status === "complete");
                        if (!manifest || !attempt.receipts?.some(receipt => receipt.recordingId === manifest.recordingId && receipt.sha256 === manifest.sha256 && receipt.stored === true)) return false;
                    }
                }
            }
        }
        return true;
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
                if (this.phase !== "ended" && context.status === "completed" && this.recovery?.kind === "upload" && this.recovery.attemptId === context.contextKey) {this.recovery = null;this.phase = "experiment";}
            }
            await this.recoveryPolicy?.maybeRetry(this);
            await this.persist();this.publish();
        });
        this.actionQueue = run;
        return run;
    }
}
module.exports = { ExperimentSession };
