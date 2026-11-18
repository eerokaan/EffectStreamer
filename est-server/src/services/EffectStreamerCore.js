const { isObject } = require("../utils/validation.js");
const { getRoundSuffix, getExperimentCondition } = require("../utils/experiment.js");
const { randomUUID } = require("node:crypto");

class EffectStreamerCore {
    // prettier-ignore
    constructor({
        state,
        config,
        clientRegistry,
        sessionFiles
    }) {
        this.state = state;
        this.config = config;
        this.clientRegistry = clientRegistry;
        this.sessionFiles = sessionFiles;
        this.recordingContextCompletedHandler = () => {};
    }

    setRecordingContextCompletedHandler(handler) {
        this.recordingContextCompletedHandler = handler;
    }

    handleMediaPrepared(socket, data) {
        // Ignore responses with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "mediaPrepared", "Data is missing or invalid");
            return;
        }

        // Ignore responses from unknown clients
        const client = this.clientRegistry.fetchClient(socket.id);
        if (!client) {
            this.clientRegistry.logEventError(socket, "mediaPrepared", "Client is unknown (Perhaps ongoing shutdown?)");
            return;
        }

        // Ignore responses for unknown recording contexts
        const recordingContext = this.state.recordingContexts.get(data.contextKey);
        if (!recordingContext) {
            this.clientRegistry.logEventError(socket, "mediaPrepared", "Recording context is unknown");
            return;
        }

        // Stop the recording context when est-core failed to start
        if (data.success === false) {
            console.log("[Server] est-core start failed for " + client.clientId + " (" + recordingContext.contextKey + "): " + (data.error ?? "n/a"));
            recordingContext.interrupted = true;
            this.recordingContextStopCommit(recordingContext);
            return;
        }

        if (this.config.deployment.mode === "remote") {
            if (data.component !== "remote" || recordingContext.status !== "startingSender") return;
            recordingContext.sockets.receiverReady.add(client.participantId);
            if (recordingContext.sockets.receiverReady.size === recordingContext.clients.length) {
                recordingContext.status = "startingMedia";
                this.state.runMedia(() => this.state.mediaAdapter.start({ session: this.state, attempt: recordingContext }));
            }
            return;
        }

        // Sender startup barrier: Start receivers after every client sender is ready
        if (data.component === "sender") {
            if (recordingContext.status !== "startingSender") {
                this.clientRegistry.logEventError(socket, "mediaPrepared", "Recording context is not starting sender components");
                return;
            }

            recordingContext.sockets.senderReady.add(client.participantId);

            if (recordingContext.sockets.senderReady.size >= recordingContext.clients.length) {
                const currentCondition = getExperimentCondition(this.config, recordingContext.scope.conditionIndex, this.state.conditionOrder);
                recordingContext.status = "startingReceiver";

                // prettier-ignore
                this.state.runMedia(() => this.state.mediaAdapter.prepare({ session: this.state, attempt: recordingContext, condition: currentCondition, component: "receiver" }));
            }
        }

        // Receiver startup barrier: Mark the context running after every client receiver is ready
        else if (data.component === "receiver") {
            if (recordingContext.status !== "startingReceiver") {
                this.clientRegistry.logEventError(socket, "mediaPrepared", "Recording context is not starting receiver components");
                return;
            }

            recordingContext.sockets.receiverReady.add(client.participantId);

            if (recordingContext.sockets.receiverReady.size >= recordingContext.clients.length) {
                recordingContext.status = "startingMedia";
                this.state.runMedia(() => this.state.mediaAdapter.start({ session: this.state, attempt: recordingContext }));
            }
        }
    }

    async handleMediaStarted(socket, data) {
        const client = this.clientRegistry.fetchClient(socket.id);
        const context = this.state.recordingContexts.get(data.contextKey);
        if (!client || !context || context.status !== "startingMedia") return;
        if (data.success === false) {context.interrupted = true;this.recordingContextStopCommit(context);return;}
        context.sockets.mediaStarted.add(client.participantId);
        if (context.sockets.mediaStarted.size === context.clients.length) {
            await this.state.mediaAdapter.release?.();
            if (context.status !== "startingMedia") return;
            context.status = "running";
            this.state.attempts.find(attempt => attempt.attemptId === context.contextKey).status = "running";
            clearTimeout(context.startupTimeout);
            context.conditionTimeout = setTimeout(() => this.state.mediaFailure(new Error("Maximum condition duration exceeded")), this.config.recordings.maxConditionSeconds * 1000);
        }
    }

    handleMediaStopped(socket, data) {
        // Ignore responses with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "mediaStopped", "Data is missing or invalid");
            return;
        }

        // Ignore responses from unknown clients
        const client = this.clientRegistry.fetchClient(socket.id);
        if (!client) {
            this.clientRegistry.logEventError(socket, "mediaStopped", "Client is unknown (Perhaps ongoing shutdown?)");
            return;
        }

        // Ignore responses for unknown recording contexts
        const recordingContext = this.state.recordingContexts.get(data.contextKey);
        if (!recordingContext) {
            this.clientRegistry.logEventError(socket, "mediaStopped", "Recording context is unknown");
            return;
        }

        if (data.success === false) recordingContext.interrupted = true;
        // Stop-response barrier: Enter upload handling after every client has stopped
        recordingContext.sockets.stopped.add(client.participantId);

        if (recordingContext.sockets.stopped.size >= recordingContext.clients.length) {
            if (recordingContext.status === "stopping") {
                recordingContext.status = "uploading";
                this.state.attempts.find(attempt => attempt.attemptId === recordingContext.contextKey).status = recordingContext.interrupted ? "interrupted" : "uploading";

                console.log("[Server] Recording context uploading: " + recordingContext.contextKey);

            }

            this.recordingContextFinalizeUpload(recordingContext);
        }
    }

    recordingContextStart(testType) {
        // Reject unknown test types
        if (!this.config.tests[testType]) {
            console.log("[Server] Not starting est-core because the supplied test type is unknown: " + testType);
            return false;
        }

        // Determine the context key and the existing recording context
        const roundSuffix = getRoundSuffix(testType, this.state.conditionListeningSpeakingTestIndex);
        const contextKey = randomUUID();
        const existingRecordingContext = this.state.recordingContexts.get(this.state.recordingContextActive);

        // Reuse the unfinished context for this condition instead of creating a duplicate
        if (existingRecordingContext && existingRecordingContext.status !== "completed") {
            console.log("[Server] Not starting est-core because recording context is already active: " + contextKey);
            this.state.recordingContextActive = existingRecordingContext.contextKey;
            return true;
        }

        // Determine the clients for the recording context
        const clients = Array.from(this.state.clientsData.values()).map((client) => ({
            clientId: client.clientId,
            participantId: client.participantId,
            socketId: client.socketId,
            ipAddress: client.ipAddress
        }));

        // Create the recording context
        const recordingContext = {
            contextKey,
            status: "startingSender",
            clients,
            scope: {
                conditionIndex: this.state.conditionIndex,
                conditionListeningSpeakingTestIndex: this.state.conditionListeningSpeakingTestIndex,
                roundSuffix,
                testType
            },
            sockets: {
                senderReady: new Set(),
                receiverReady: new Set(),
                mediaStarted: new Set(),
                stopped: new Set(),
                viewChangePending: new Set()
            },
            files: {
                uploaded: new Set(),
                failed: new Set()
            }
        };

        // Determine the current experiment condition
        const currentCondition = getExperimentCondition(this.config, recordingContext.scope.conditionIndex, this.state.conditionOrder);

        // Store the recording context and mark it as active
        this.state.recordingContexts.set(contextKey, recordingContext);
        this.state.recordingContextActive = contextKey;
        this.state.attempts.push({ attemptId: contextKey, testType, conditionIndex: this.state.conditionIndex, roundSuffix, status: "preparing" });

        // Enter sender startup handling with a timeout guard
        recordingContext.startupTimeout = setTimeout(() => {
            if (["startingSender", "startingReceiver", "startingMedia"].includes(recordingContext.status)) {
                console.log("[Server] Recording context startup timed out: " + recordingContext.contextKey);
                this.state.mediaFailure(new Error("Media startup timed out"));
            }
        }, this.config.deployment.mode === "remote" ? this.config.remote.startupTimeoutMs * 3 : 30000);

        console.log("[Server] Recording context starting: " + contextKey);

        // Start sender components with peer and condition settings
        this.state.runMedia(() => this.state.mediaAdapter.prepare({ session: this.state, attempt: recordingContext, condition: currentCondition, component: "sender" }));

        return true;
    }

    // prettier-ignore
    recordingContextStopPrepare(socket, testType) {
        const recordingContext = this.state.recordingContextActive ? this.state.recordingContexts.get(this.state.recordingContextActive) : null;

        // Ignore requests without a matching active recording context
        if (!recordingContext || recordingContext.scope.testType !== testType) {
            this.clientRegistry.logEventError(socket, "viewChangeRequest", "No matching active recording context is available");
            return { status: "completed" };
        }

        // Track the socket as waiting for the view change
        const participant = this.clientRegistry.fetchClient(socket.id);
        if (!participant) return { status: "pending" };
        recordingContext.sockets.viewChangePending.add(participant.participantId);

        // Report completion for already completed recording contexts
        if (recordingContext.status === "completed") {
            return { status: "completed" };
        }

        // Stop the recording context while it is still starting or running
        if (
            recordingContext.status === "startingSender" ||
            recordingContext.status === "startingReceiver" ||
            recordingContext.status === "startingMedia" ||
            recordingContext.status === "running"
        ) {
            this.recordingContextStopCommit(recordingContext);
        }

        return { status: "pending" };
    }

    // prettier-ignore
    recordingContextStopCommit(recordingContext) {
        // Ignore recording contexts that are neither starting nor running
        if (
            recordingContext.status !== "startingSender" &&
            recordingContext.status !== "startingReceiver" &&
            recordingContext.status !== "startingMedia" &&
            recordingContext.status !== "running"
        ) {
            return;
        }

        // Enter stopping handling
        recordingContext.status = "stopping";
        const attempt = this.state.attempts.find(attempt => attempt.attemptId === recordingContext.contextKey);
        attempt.status = recordingContext.interrupted ? "interrupted" : "stopping";
        attempt.uploadDeadline ||= Date.now() + this.config.recordings.uploadTimeoutMs;
        clearTimeout(recordingContext.startupTimeout);
        clearTimeout(recordingContext.conditionTimeout);
        console.log("[Server] Recording context stopping: " + recordingContext.contextKey);

        // Request the media stop; status is published in snapshots.
        this.state.runMedia(async () => {
            try {await this.state.mediaAdapter.stop({ session: this.state, attempt: recordingContext, reason: recordingContext.interrupted ? "interrupted" : "completed" });}
            finally {recordingContext.workerStopped = true;}
            await this.state.recoveryPolicy?.maybeRetry(this.state);
        });
    }

    // prettier-ignore
    recordingContextFinalizeUpload(recordingContext) {
        const expectedFileEntryCount = recordingContext.clients.length * 2;
        const completedFileEntryCount = recordingContext.files.uploaded.size;

        // Ignore recording contexts with pending files or pending client stops
        if (
            completedFileEntryCount < expectedFileEntryCount ||
            recordingContext.interrupted ||
            recordingContext.status === "completed" ||
            recordingContext.sockets.stopped.size < recordingContext.clients.length
        ) {
            return;
        }

        // Enter completed handling
        recordingContext.status = "completed";
        this.state.attempts.find(attempt => attempt.attemptId === recordingContext.contextKey).status = "completed";
        clearTimeout(recordingContext.startupTimeout);

        // Release the active recording context and log the outcome
        if (this.state.recordingContextActive === recordingContext.contextKey) {
            this.state.recordingContextActive = null;
        }
        console.log("[Server] Recording context completed: " + recordingContext.contextKey);

        // Notify the clients and hand over to the completion handler
        // Cleanup is authorized only by individual durable receipts returned by HTTP.
        if (this.state.phase !== "ended") this.recordingContextCompletedHandler(recordingContext);
    }
}

module.exports = { EffectStreamerCore };
