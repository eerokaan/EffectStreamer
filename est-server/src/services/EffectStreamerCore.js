const { isObject } = require("../utils/validation.js");
const { buildRecordingFilename } = require("../utils/filenames.js");
const { getRoundSuffix, getExperimentCondition, getRecordingContextKey } = require("../utils/experiment.js");

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

    handleCoreStartResponse(socket, data) {
        // Ignore responses with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "coreStartResponse", "Data is missing or invalid");
            return;
        }

        // Ignore responses from unknown clients
        const client = this.clientRegistry.fetchClient(socket.id);
        if (!client) {
            this.clientRegistry.logEventError(socket, "coreStartResponse", "Client is unknown (Perhaps ongoing shutdown?)");
            return;
        }

        // Ignore responses for unknown recording contexts
        const recordingContext = this.state.recordingContexts.get(data.contextKey);
        if (!recordingContext) {
            this.clientRegistry.logEventError(socket, "coreStartResponse", "Recording context is unknown");
            return;
        }

        // Stop the recording context when est-core failed to start
        if (data.success === false) {
            console.log("[Server] est-core start failed for " + client.clientId + " (" + recordingContext.contextKey + "): " + (data.error ?? "n/a"));
            this.recordingContextStopCommit(recordingContext);
            return;
        }

        // Sender startup barrier: Start receivers after every client sender is ready
        if (data.component === "sender") {
            if (recordingContext.status !== "startingSender") {
                this.clientRegistry.logEventError(socket, "coreStartResponse", "Recording context is not starting sender components");
                return;
            }

            recordingContext.sockets.senderReady.add(socket.id);

            if (recordingContext.sockets.senderReady.size >= recordingContext.clients.length) {
                const currentCondition = getExperimentCondition(this.config, recordingContext.scope.conditionIndex, this.state.conditionOrder);
                recordingContext.status = "startingReceiver";

                // prettier-ignore
                this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
                    contextKey: recordingContext.contextKey,
                    testType: recordingContext.scope.testType,
                    status: "startingReceiver"
                });

                // prettier-ignore
                for (const client of recordingContext.clients) {
                    this.clientRegistry.emitToSocket(client.socketId, "est-event:coreStartRequest", {
                        contextKey: recordingContext.contextKey,
                        component: "receiver",
                        testType: recordingContext.scope.testType,
                        nativeGain: currentCondition.nativeGain,
                        echoGain: currentCondition.echoGain
                    });
                }
            }
        }

        // Receiver startup barrier: Mark the context running after every client receiver is ready
        else if (data.component === "receiver") {
            if (recordingContext.status !== "startingReceiver") {
                this.clientRegistry.logEventError(socket, "coreStartResponse", "Recording context is not starting receiver components");
                return;
            }

            recordingContext.sockets.receiverReady.add(socket.id);

            if (recordingContext.sockets.receiverReady.size >= recordingContext.clients.length) {
                recordingContext.status = "running";
                clearTimeout(recordingContext.startupTimeout);

                console.log("[Server] Recording context running: " + recordingContext.contextKey);

                // prettier-ignore
                this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
                    contextKey: recordingContext.contextKey,
                    testType: recordingContext.scope.testType,
                    status: "running"
                });
            }
        }
    }

    handleCoreStopResponse(socket, data) {
        // Ignore responses with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "coreStopResponse", "Data is missing or invalid");
            return;
        }

        // Ignore responses without a context key when no upload is expected
        if (data.upload === false && !data.contextKey) {
            return;
        }

        // Ignore responses from unknown clients
        const client = this.clientRegistry.fetchClient(socket.id);
        if (!client) {
            this.clientRegistry.logEventError(socket, "coreStopResponse", "Client is unknown (Perhaps ongoing shutdown?)");
            return;
        }

        // Ignore responses for unknown recording contexts
        const recordingContext = this.state.recordingContexts.get(data.contextKey);
        if (!recordingContext) {
            this.clientRegistry.logEventError(socket, "coreStopResponse", "Recording context is unknown");
            return;
        }

        // Stop-response barrier: Enter upload handling after every client has stopped
        recordingContext.sockets.stopped.add(socket.id);

        if (recordingContext.sockets.stopped.size >= recordingContext.clients.length) {
            if (recordingContext.status === "stopping") {
                recordingContext.status = "uploading";

                console.log("[Server] Recording context uploading: " + recordingContext.contextKey);

                // prettier-ignore
                this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
                    contextKey: recordingContext.contextKey,
                    testType: recordingContext.scope.testType,
                    status: "uploading"
                });
            }

            this.recordingContextFinalizeUpload(recordingContext);
        }
    }

    handleRecordingStateUpdateResponse(socket, data) {
        // Ignore responses with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "recordingStateUpdateResponse", "Data is missing or invalid");
            return;
        }

        // Determine the client ID for the log output
        const client = this.clientRegistry.fetchClient(socket.id);
        const clientId = client ? client.clientId : "unknown client";

        // Simply acknowledge state change in console output
        console.log("[Server] Recording state update response from " + clientId + ": " + JSON.stringify(data));
    }

    handleFileTransferRequest(socket, data) {
        // Ignore requests with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "Data is missing or invalid");
            return;
        }

        // Determine the client, the recording context and the allowed file names
        const client = this.clientRegistry.fetchClient(socket.id);
        const recordingContext = this.state.recordingContexts.get(data.contextKey);
        const recordingFileNames = new Set(["microphone.ogg", "headphones.ogg", "audio-transport.json"]);

        // Ignore requests from unknown clients
        if (!client) {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "Client is unknown (Perhaps ongoing shutdown?)");
            return;
        }

        // Ignore requests for unknown recording contexts
        if (!recordingContext) {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "Recording context is unknown");
            return;
        }

        // Ignore requests for already completed recording contexts
        if (recordingContext.status === "completed") {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "Recording context is already completed");
            return;
        }

        // Ignore requests for recording contexts that are not ready for file transfer
        if (recordingContext.status !== "stopping" && recordingContext.status !== "uploading") {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "Recording context is not ready for file transfer");
            return;
        }

        // Ignore requests with an unknown file name
        if (!recordingFileNames.has(data.fileName)) {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "The supplied file name is unknown");
            return;
        }

        // Determine the file entry key and the recording context membership
        const fileEntryKey = client.clientId + ":" + data.fileName;
        const matchesRecordingContext = recordingContext.clients.some((recordingClient) => recordingClient.clientId === client.clientId);

        // Ignore requests for files that do not belong to this recording context
        if (!matchesRecordingContext) {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "The supplied file does not belong to this recording context");
            return;
        }

        // Track empty files as a failed transfer (e.g. failed recordings)
        if (data.fileData == null) {
            this.recordingFileTransferFailed(recordingContext, client, fileEntryKey, data.fileName, data.error);
            return;
        }

        // Ignore requests for already received files
        if (recordingContext.files.uploaded.has(fileEntryKey)) {
            this.clientRegistry.logEventError(socket, "fileTransferRequest", "The supplied file was already received");
            return;
        }

        // Track invalid file data as a failed transfer
        let fileData = null;
        try {
            fileData = Buffer.from(data.fileData);
        }
        catch (error) {
            this.recordingFileTransferFailed(recordingContext, client, fileEntryKey, data.fileName, "Invalid file data: " + error.message);
            return;
        }

        // For newly received and healthy files
        try {
            const serverFilename = buildRecordingFilename(client.clientId, recordingContext.scope.testType, recordingContext.scope.roundSuffix, data.fileName);
            this.sessionFiles.saveFile("conditionDir", serverFilename, fileData, recordingContext.scope.conditionIndex);
        }
        catch (error) {
            this.recordingFileTransferFailed(recordingContext, client, fileEntryKey, data.fileName, "Unable to save file: " + error.message);
            return;
        }

        // For newly received and healthy files: Track the file as received and clear previous failures
        recordingContext.files.uploaded.add(fileEntryKey);
        recordingContext.files.failed.delete(fileEntryKey);

        // For newly received and healthy files: Enter upload handling
        if (recordingContext.status === "stopping") {
            recordingContext.status = "uploading";

            // prettier-ignore
            this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
                contextKey: recordingContext.contextKey,
                testType: recordingContext.scope.testType,
                status: "uploading"
            });
        }

        this.recordingContextFinalizeUpload(recordingContext);
    }

    recordingFileTransferFailed(recordingContext, client, fileEntryKey, fileName, error) {
        // Ignore failures for already received files
        if (recordingContext.files.uploaded.has(fileEntryKey)) {
            return;
        };

        // Track the file as failed and log the outcome
        recordingContext.files.failed.add(fileEntryKey);
        console.log("[Server] Recording file transfer failed for " + client.clientId + " (" + recordingContext.contextKey + "): " + fileName + (error ? " - " + error : ""));

        // Enter upload handling
        if (recordingContext.status === "stopping") {
            recordingContext.status = "uploading";

            // prettier-ignore
            this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
                contextKey: recordingContext.contextKey,
                testType: recordingContext.scope.testType,
                status: "uploading"
            });
        }

        this.recordingContextFinalizeUpload(recordingContext);
    }

    recordingContextStart(testType) {
        // Reject unknown test types
        if (!this.config.tests[testType]) {
            console.log("[Server] Not starting est-core because the supplied test type is unknown: " + testType);
            return false;
        }

        // Determine the context key and the existing recording context
        const roundSuffix = getRoundSuffix(testType, this.state.conditionListeningSpeakingTestIndex);
        const contextKey = getRecordingContextKey(this.state.conditionIndex, testType, roundSuffix);
        const existingRecordingContext = this.state.recordingContexts.get(contextKey);

        // Reuse the unfinished context for this condition instead of creating a duplicate
        if (existingRecordingContext && existingRecordingContext.status !== "completed") {
            console.log("[Server] Not starting est-core because recording context is already active: " + contextKey);
            this.state.recordingContextActive = contextKey;
            return true;
        }

        // Determine the clients for the recording context
        const clients = Array.from(this.state.clientsData.values()).map((client) => ({
            clientId: client.clientId,
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

        // Enter sender startup handling with a timeout guard
        recordingContext.startupTimeout = setTimeout(() => {
            if (recordingContext.status === "startingSender" || recordingContext.status === "startingReceiver") {
                console.log("[Server] Recording context startup timed out: " + recordingContext.contextKey);
                this.recordingContextStopCommit(recordingContext);
            }
        }, 30000);

        console.log("[Server] Recording context starting: " + contextKey);

        // prettier-ignore
        this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
            contextKey,
            testType,
            status: "startingSender"
        });

        // Start sender components with peer and condition settings
        for (const client of clients) {
            let peerClient = null;

            for (const registeredClient of clients) {
                if (registeredClient.clientId !== client.clientId) {
                    peerClient = registeredClient;
                    break;
                }
            }

            this.clientRegistry.emitToSocket(client.socketId, "est-event:coreStartRequest", {
                contextKey,
                component: "sender",
                testType,
                core: {
                    ipAddress: peerClient.ipAddress,
                    delay: {
                        native: currentCondition.nativeDelay,
                        echo: currentCondition.echoDelay
                    },
                    packetloss: {
                        type: currentCondition.packetlossType,
                        ratio: currentCondition.packetlossRatio,
                        seed: currentCondition.packetlossSeed,
                        burstModel: currentCondition.packetlossBurstModel,
                        burstRatio: currentCondition.packetlossBurstRatio
                    }
                }
            });
        }

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
        recordingContext.sockets.viewChangePending.add(socket.id);

        // Report completion for already completed recording contexts
        if (recordingContext.status === "completed") {
            return { status: "completed" };
        }

        // Stop the recording context while it is still starting or running
        if (
            recordingContext.status === "startingSender" ||
            recordingContext.status === "startingReceiver" ||
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
            recordingContext.status !== "running"
        ) {
            return;
        }

        // Enter stopping handling
        recordingContext.status = "stopping";
        clearTimeout(recordingContext.startupTimeout);
        console.log("[Server] Recording context stopping: " + recordingContext.contextKey);

        // Notify the clients and request the core stop
        this.clientRegistry.emitToAll("est-event:recordingStateUpdateRequest", {
            contextKey: recordingContext.contextKey,
            testType: recordingContext.scope.testType,
            status: "stopping"
        });
        this.clientRegistry.emitToAll("est-event:coreStopRequest", {
            contextKey: recordingContext.contextKey,
            testType: recordingContext.scope.testType,
            upload: true
        });
    }

    // prettier-ignore
    recordingContextFinalizeUpload(recordingContext) {
        const expectedFileEntryCount = recordingContext.clients.length * 3;
        const completedFileEntryCount = recordingContext.files.uploaded.size + recordingContext.files.failed.size;

        // Ignore recording contexts with pending files or pending client stops
        if (
            completedFileEntryCount < expectedFileEntryCount ||
            recordingContext.status === "completed" ||
            recordingContext.sockets.stopped.size < recordingContext.clients.length
        ) {
            return;
        }

        // Enter completed handling
        recordingContext.status = "completed";
        clearTimeout(recordingContext.startupTimeout);

        // Release the active recording context and log the outcome
        if (this.state.recordingContextActive === recordingContext.contextKey) {
            this.state.recordingContextActive = null;
        }
        console.log("[Server] Recording context completed: " + recordingContext.contextKey + (recordingContext.files.failed.size > 0 ? " (with failures)" : ""));

        // Notify the clients and hand over to the completion handler
        this.clientRegistry.emitToAll("est-event:fileTransferResponse", {
            contextKey: recordingContext.contextKey,
            testType: recordingContext.scope.testType
        });
        this.recordingContextCompletedHandler(recordingContext);
    }
}

module.exports = { EffectStreamerCore };
