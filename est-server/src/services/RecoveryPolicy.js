const { EVENTS } = require("@effectstreamer/common");

class RecoveryPolicy {
    constructor({ config, registry, now = Date.now }) {
        this.config = config;this.registry = registry;this.now = now;
        this.timer = setInterval(() => {for (const session of registry.sessions.values()) void this.expire(session.sessionId).catch(error => {session.persistenceError = error;});}, 250);this.timer.unref();
    }
    key(context) {return [context.scope.conditionIndex, context.scope.testType, context.scope.roundSuffix].join(":");}
    async disconnected(participantId, reason) {
        const session = this.registry.getForParticipant(participantId);
        if (!session || session.phase === "ended" || session.disposed) return;
        if (session.recovery) {await session.persist();session.publish();return;}
        const context = session.recordingContexts.get(session.recordingContextActive);
        const attempt = session.attempts.find(attempt => attempt.attemptId === context?.contextKey);
        const uploading = context && ["stopping", "uploading"].includes(context.status) && !context.interrupted && !["worker", "media"].includes(reason);
        session.recovery = { kind: uploading ? "upload" : context ? "conversation" : "between", attemptId: context?.contextKey || null,
            deadline: uploading ? (attempt.uploadDeadline ||= this.now() + this.config.recordings.uploadTimeoutMs) : this.now() + this.config.sessions.reconnectGraceMs,
            reason, acknowledged: [], resumed: [] };
        session.phase = "interrupted";session.gates.viewChange.clear();
        if (context && !uploading) {
            context.interrupted = true;attempt.status = "interrupted";
            if (this.config.audioSetup.enabled) for (const client of session.clientsData.values()) {client.setupComplete = false;this.registry.enrollments.get(client.participantId).setupComplete = false;}
            this.registry.enrollments.save();session.effectStreamerCore.recordingContextStopCommit(context);
        }
        await session.persist();session.publish();
        session.clientRegistry.emitToAll(EVENTS.mediaCommand, { type: "requestResume" });
        if (context && !uploading && (session.retryCounts?.[this.key(context)] || 0) >= this.config.sessions.maxRetries) await this.end(session, "technicalFailure");
    }
    async resumed(participantId, { manifests = [], mediaPresent = false } = {}, { registered = false } = {}) {
        const session = this.registry.getForParticipant(participantId);if (!session) throw new Error("Unknown recovery participant");
        if (!Array.isArray(manifests) || manifests.length > 64) throw new Error("Invalid retained recording inventory");
        if (!session.recovery && session.recordingContextActive && !mediaPresent && session.phase !== "ended") await this.disconnected(participantId, "pageReload");
        for (const attemptId of registered ? [] : new Set(manifests.map(manifest => manifest.attemptId))) {
            const owned = manifests.filter(manifest => manifest.attemptId === attemptId);
            if (owned.some(manifest => manifest.participantId !== participantId || manifest.sessionId !== session.sessionId)) throw new Error("Invalid retained recording owner");
            await session.transfers.register({ participantId }, owned);
            session.clientRegistry.emitToSocket(session.clientsData.get(participantId).socketId, EVENTS.recordingRequest, { attemptId, recordingIds: owned.map(manifest => manifest.recordingId) });
        }
        const recovery = session.recovery;
        if (!recovery) return;
        if (!recovery.resumed.includes(participantId)) recovery.resumed.push(participantId);
        const context = session.recordingContexts.get(recovery.attemptId), attempt = session.attempts.find(attempt => attempt.attemptId === recovery.attemptId);
        if (attempt && !mediaPresent) {
            const missing = ["microphone", "headphones"].filter(track => !manifests.some(manifest => manifest.attemptId === attempt.attemptId && manifest.track === track) && !attempt.recordings?.some(manifest => manifest.participantId === participantId && manifest.track === track && attempt.receipts?.some(receipt => receipt.recordingId === manifest.recordingId && receipt.stored)));
            if (missing.length) {
                attempt.missingRecordings ||= [];const previous = attempt.missingRecordings.find(entry => entry.participantId === participantId);
                if (previous) previous.tracks = missing;else attempt.missingRecordings.push({ participantId, tracks: missing });
            }
            context?.sockets.stopped.add(participantId);
            if (missing.length && recovery.kind === "upload" && session.phase !== "ended") {await this.end(session, "technicalFailure");return;}
        }
        await session.persist();session.publish();await this.maybeRetry(session);
    }
    async reconnected(participantId, { ready = false } = {}) {
        const session = this.registry.getForParticipant(participantId);if (!session?.recovery || session.phase === "ended") throw new Error("No recoverable session");
        const client = session.clientsData.get(participantId);
        if (!client.socketId || (this.config.audioSetup.enabled && !client.setupComplete)) throw new Error("Repeat audio setup before retrying");
        if (ready && !session.recovery.acknowledged.includes(participantId)) session.recovery.acknowledged.push(participantId);
        await session.persist();session.publish();await this.maybeRetry(session);
    }
    async maybeRetry(session) {
        const recovery = session.recovery;if (!recovery || session.phase === "ended" || recovery.kind === "upload") return;
        if (this.now() > recovery.deadline) {await this.end(session, "technicalFailure");return;}
        const people = [...session.clientsData.values()];
        if (people.some(client => !client.socketId || !recovery.acknowledged.includes(client.participantId) || !recovery.resumed.includes(client.participantId) || (this.config.audioSetup.enabled && !client.setupComplete))) return;
        const old = session.recordingContexts.get(recovery.attemptId), attempt = session.attempts.find(attempt => attempt.attemptId === recovery.attemptId);
        if (attempt) {
            if (!old.workerStopped || old.sockets.stopped.size !== people.length) return;
            for (const client of people) for (const track of ["microphone", "headphones"]) {
                const missing = attempt.missingRecordings?.some(entry => entry.participantId === client.participantId && entry.tracks.includes(track));
                const manifest = attempt.recordings?.find(manifest => manifest.participantId === client.participantId && manifest.track === track);
                if (!missing && (!manifest || !attempt.receipts?.some(receipt => receipt.recordingId === manifest.recordingId && receipt.stored))) return;
            }
            const key = this.key(old);session.retryCounts ||= {};
            if ((session.retryCounts[key] || 0) >= this.config.sessions.maxRetries) {await this.end(session, "technicalFailure");return;}
            session.retryCounts[key] = (session.retryCounts[key] || 0) + 1;
            old.status = "interrupted";attempt.status = "interrupted";session.recordingContextActive = null;
            session.conditionIndex = old.scope.conditionIndex;session.conditionListeningSpeakingTestIndex = old.scope.conditionListeningSpeakingTestIndex;
        }
        session.recovery = null;session.phase = "experiment";
        if (old) {
            session.effectStreamerCore.recordingContextStart(old.scope.testType);
            const view = session.viewFlow.getViewByName(old.scope.testType === "sct" ? "viewShortConversationTestMain" : "viewListeningSpeakingTestMain");
            for (const client of people) {client.currentView = view.name;client.viewData = session.viewFlow.getViewData(view, client);}
        }
        await session.persist();session.publish();
    }
    async expire(sessionId) {
        const session = this.registry.sessions.get(sessionId);
        if (session && session.phase !== "ended" && !session.recovery) {
            const active = session.recordingContexts.get(session.recordingContextActive), attempt = session.attempts.find(attempt => attempt.attemptId === active?.contextKey);
            if (active && ["stopping", "uploading"].includes(active.status) && attempt?.uploadDeadline && this.now() > attempt.uploadDeadline) {await this.end(session, "technicalFailure");return;}
        }
        if (session?.recovery && session.phase !== "ended" && this.now() > session.recovery.deadline) await this.end(session, "technicalFailure");
    }
    async end(session, outcome) {
        if (session.phase === "ended") return;
        session.phase = "ended";session.outcome = outcome;
        const active = session.recordingContexts.get(session.recordingContextActive);
        if (active && !["completed", "uploading", "stopping", "interrupted"].includes(active.status)) {active.interrupted = true;session.effectStreamerCore.recordingContextStopCommit(active);}
        for (const client of session.clientsData.values()) {client.currentView = "viewEnding";client.viewData = {};this.registry.enrollments.get(client.participantId).outcome = outcome;}
        this.registry.enrollments.save();await session.persist();session.publish();
    }
    async recoverAfterRestart(manifests) {
        for (const manifest of manifests) {
            const session = this.registry.restore(manifest), context = session.recordingContexts.get(session.recordingContextActive);
            if (session.phase === "ended") continue;
            if (manifest.configurationHash !== session.configurationHash()) {await this.end(session, "technicalFailure");continue;}
            if (context && ["stopping", "uploading"].includes(context.status) && !context.interrupted) {
                const attempt = session.attempts.find(attempt => attempt.attemptId === context.contextKey);
                context.workerStopped = true;
                session.phase = "interrupted";session.recovery = { kind: "upload", attemptId: context.contextKey, deadline: attempt.uploadDeadline || this.now(), reason: "restart", acknowledged: [], resumed: [] };
                await session.persist();await this.expire(session.sessionId);
            }
            else if (context || session.recovery || manifest.configurationHash !== session.configurationHash()) {
                if (context) {context.interrupted = true;context.status = "interrupted";session.attempts.find(attempt => attempt.attemptId === context.contextKey).status = "interrupted";}
                await this.end(session, "technicalFailure");
            }
        }
    }
    close() {clearInterval(this.timer);}
}
module.exports = { RecoveryPolicy };
