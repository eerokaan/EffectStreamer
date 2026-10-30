const { isObject } = require("../utils/validation.js");
const { buildScaleFilename } = require("../utils/filenames.js");
const { createShuffledIndices } = require("../utils/random.js");
const { getRoundSuffix, getExperimentCondition } = require("../utils/experiment.js");

class ExperimentFlow {
    // prettier-ignore
    constructor({
        state,
        config,
        views,
        viewFlow,
        clientRegistry,
        sessionFiles,
        effectStreamerCore
    }) {
        this.state = state;
        this.config = config;
        this.views = views;
        this.viewFlow = viewFlow;
        this.clientRegistry = clientRegistry;
        this.sessionFiles = sessionFiles;
        this.effectStreamerCore = effectStreamerCore;
    }

    handleViewChangeRequest(socket, data) {
        // Ignore requests with missing or invalid data
        if (!isObject(data)) {
            this.clientRegistry.logEventError(socket, "viewChangeRequest", "Data is missing or invalid");
            return;
        }

        // Validate client
        const client = this.clientRegistry.fetchClient(socket.id);
        if (!client) {
            this.clientRegistry.logEventError(socket, "viewChangeRequest", "Client is unknown (Perhaps ongoing shutdown?)");
            return;
        }

        // Validate currentView
        const currentView = this.viewFlow.getViewByName(data.currentView);
        if (!currentView) {
            this.clientRegistry.logEventError(socket, "viewChangeRequest", "Requested view is unknown");
            return;
        }
        if (client.currentView !== currentView.name) return;

        // Write scale data to file if applicable
        if (data.scaleValues) {
            const roundSuffix = getRoundSuffix(currentView.metadata.testType, this.state.conditionListeningSpeakingTestIndex);
            const serverFilename = buildScaleFilename(client.clientId, currentView.metadata.testType, roundSuffix);
            this.sessionFiles.saveFile("conditionDir", serverFilename, JSON.stringify(data.scaleValues, null, 4));
        }

        // Views with direct passing
        if (currentView.passing === "direct") {
            this.resolveDirectViewChange(socket, client, currentView);
        }

        // Views with gated passing
        else if (currentView.passing === "gated") {
            this.state.gates.viewChange.add(client.participantId);

            // Both clients now want to proceed
            if (this.state.gates.viewChange.size === 2) {
                this.resolveGatedViewChange(currentView);
            }
        }
    }

    resolveDirectViewChange(socket, client, currentView) {
        const nextView = this.viewFlow.getNextView(currentView);

        // Determine the test type of the current view
        let currentViewTestType = null;
        if (currentView.name === this.views.sctMain) currentViewTestType = "sct";
        if (currentView.name === this.views.lstMain) currentViewTestType = "lst";

        // Prevent direct passing for views with recording contexts
        if (currentViewTestType) {
            // Stop active recording context before leaving the test view
            const stopResult = this.effectStreamerCore.recordingContextStopPrepare(socket, currentViewTestType);
            if (stopResult.status === "completed") {
                this.clientRegistry.emitToSocket(socket.id, "est-event:viewChangeResponse", this.viewFlow.getViewData(nextView, client));
                return;
            }

            // Notify peer that they were left in the room while this recording context is being stopped and uploaded
            const peerClient = this.clientRegistry.fetchPeerClient(client);
            if (peerClient) {
                this.clientRegistry.emitToSocket(peerClient.socketId, "est-event:viewChangeResponse", {
                    showDialog: true
                });
            }
            return;
        }

        // Continue direct navigation when no recording context is active
        this.clientRegistry.emitToSocket(socket.id, "est-event:viewChangeResponse", this.viewFlow.getViewData(nextView, client));
    }

    resolveGatedViewChange(currentView) {
        const nextView = this.viewFlow.getNextView(currentView);
        const isFirstLstEval = currentView.name === this.views.lstEval && this.state.conditionListeningSpeakingTestIndex === 0;
        const isLoopEndView = currentView.metadata.loopBehaviour === "end" && !isFirstLstEval;

        // Advance to the next condition when the loop continues
        if (isLoopEndView && nextView.name !== this.views.ending) {
            this.state.conditionIndex++;

            // Log current condition to file and console
            const currentCondition = getExperimentCondition(this.config, this.state.conditionIndex, this.state.conditionOrder);
            this.sessionFiles.saveFile("conditionDir", "condition-settings.json", JSON.stringify(currentCondition, null, 4));
            console.log("[Server] Round " + this.state.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
        }

        // Initialize condition order when entering the first condition
        else if (this.state.conditionIndex === 0 && nextView.metadata.loopBehaviour === "start") {
            // Shuffle the random condition list for random order
            this.state.conditionOrder = createShuffledIndices(this.config.conditions.random.length);

            // Log current condition to file and console
            const currentCondition = getExperimentCondition(this.config, this.state.conditionIndex, this.state.conditionOrder);
            this.sessionFiles.saveFile("conditionDir", "condition-settings.json", JSON.stringify(currentCondition, null, 4));
            console.log("[Server] Round " + this.state.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
        }

        // For LST: Set current LST round index based on view position
        if (nextView.name === this.views.lstExp) this.state.conditionListeningSpeakingTestIndex = 0;
        if (isFirstLstEval) this.state.conditionListeningSpeakingTestIndex = 1;
        if (isLoopEndView) this.state.conditionListeningSpeakingTestIndex = 0;

        // Start recording before entering an SCT/LST main view
        // Cancel the transition and restore LST state if startup is rejected
        let recordingContextStarted = true;
        if (nextView.name === this.views.sctMain) recordingContextStarted = this.effectStreamerCore.recordingContextStart("sct");
        else if (nextView.name === this.views.lstMain) recordingContextStarted = this.effectStreamerCore.recordingContextStart("lst");

        const responseView = recordingContextStarted ? nextView : currentView;
        if (!recordingContextStarted && isFirstLstEval) this.state.conditionListeningSpeakingTestIndex = 0;

        if (nextView.name === this.views.ending && !this.state.completionReady()) throw new Error("Required responses and recordings are not complete");

        for (const client of this.state.clientsData.values()) {
            this.clientRegistry.emitToSocket(client.socketId, "est-event:viewChangeResponse", this.viewFlow.getViewData(responseView, client));
        }

        this.state.gates.viewChange.clear();
        if (!recordingContextStarted) return;

        // Ending this pair never exits the shared coordinator.
        if (nextView.name === this.views.ending) {
            this.state.phase = "ended";
            this.state.outcome = "completed";
            for (const client of this.state.clientsData.values()) this.state.enrollments.get(client.participantId).outcome = "completed";
            this.state.enrollments.save();
        }
    }

    resolvePendingRecordingViewChanges(recordingContext) {
        const currentViewName = recordingContext.scope.testType === "sct" ? this.views.sctMain : this.views.lstMain;
        const currentView = this.viewFlow.getViewByName(currentViewName);
        const nextView = this.viewFlow.getNextView(currentView);

        // Release clients waiting for recording completion
        for (const participantId of recordingContext.sockets.viewChangePending) {
            const client = this.state.clientsData.get(participantId);
            if (client) {
                // Persist the authoritative next view even when the participant
                // is offline during the last receipt/restart reconciliation.
                client.currentView = nextView.name;client.viewData = this.viewFlow.getViewData(nextView, client);
                this.clientRegistry.emitToSocket(client.socketId, "est-event:viewChangeResponse", client.viewData);
            }
        }

        recordingContext.sockets.viewChangePending.clear();
    }
}

module.exports = { ExperimentFlow };
