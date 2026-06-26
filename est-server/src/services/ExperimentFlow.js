class ExperimentFlow {
    constructor({ state, estConfig, views, viewFlow, clientRegistry, sessionFiles }) {
        this.state = state;
        this.estConfig = estConfig;
        this.views = views;
        this.viewFlow = viewFlow;
        this.clientRegistry = clientRegistry;
        this.sessionFiles = sessionFiles;
    }

    handleViewChangeRequest(socket, data) {
        const payload = data ?? {};

        const client = this.clientRegistry.getBySocketId(socket.id);
        if (!client) {
            this.clientRegistry.logIgnoredEvent(socket, "viewChangeRequest");
            return;
        }

        const view = this.viewFlow.viewFlow.find((view) => view.name === payload.currentView);
        if (!view) {
            this.clientRegistry.logIgnoredEvent(socket, "viewChangeRequest", "Requested view is unknown");
            return;
        }

        // Optional: Write scale data file if provided (for evaluation views)
        if (payload.scaleValues) {
            const roundSuffix = view.metadata.testType === "lst" ? "-r" + (this.state.conditionListeningSpeakingTestIndex + 1) : "";
            const serverFilename = "client-" + client.clientLabel + "-" + view.metadata.testType + roundSuffix + "-scales.json";
            this.sessionFiles.saveFile("conditionDir", serverFilename, JSON.stringify(payload.scaleValues, null, 4));
        }

        // Views with direct passing
        const viewNext = this.viewFlow.getNextView(view.name);

        if (view.passing === "direct") {
            this.clientRegistry.emitToSocket(socket.id, "est-event:viewChangeResponse", this.viewFlow.getViewData(viewNext, socket.id));

            // On SCT and LST testing views: Notify partner that they were left in the room
            let peerSocketId = null;
            for (const registeredClient of this.state.clientsData.values()) {
                if (registeredClient.clientId !== client.clientId) {
                    peerSocketId = registeredClient.socketId;
                    break;
                }
            }

            if (peerSocketId && (view.name === this.views.sctMain || view.name === this.views.lstMain)) {
                this.clientRegistry.emitToSocket(peerSocketId, "est-event:viewChangeResponse", {
                    showDialog: true
                });
            }
        }

        // Views with gated passing
        else if (view.passing === "gated") {
            this.state.gates.viewChange.add(socket.id);

            // Both clients now want to proceed
            if (this.state.gates.viewChange.size === 2) {
                this.resolveGatedViewChange(view.name);
            }
        }
    }

    resolveGatedViewChange(currentViewName) {
        const viewNext = this.viewFlow.getNextView(currentViewName);
        const view = this.viewFlow.viewFlow.find((view) => view.name === currentViewName);
        const currentViewTestType = view?.metadata?.testType;

        if (currentViewTestType) {
            const roundSuffix = currentViewTestType === "lst" ? "-r" + (this.state.conditionListeningSpeakingTestIndex + 1) : "";
            const transferKey = String(this.state.conditionIndex + 1).padStart(4, "0") + ":" + currentViewTestType + roundSuffix;

            if (!this.state.fileTransferCompletedKeys.has(transferKey)) {
                this.state.fileTransferPendingViewName = currentViewName;
                return;
            }
        }

        const isFirstLstEval = currentViewName === this.views.lstEval && this.state.conditionListeningSpeakingTestIndex === 0;
        const isLoopEndView = view.metadata?.loopBehaviour === "end" && !isFirstLstEval;
        const loopStartViewName = this.viewFlow.viewFlow.find((view) => view.metadata?.loopBehaviour === "start")?.name;

        if (isLoopEndView && viewNext !== this.views.ending) {
            this.state.conditionIndex++;

            const currentCondition = this.state.conditionIndex === 0 ? this.estConfig.conditions.baseline[0] : this.estConfig.conditions.random[this.state.conditionOrder[this.state.conditionIndex - 1]];
            console.log("[Server] Round " + this.state.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
            this.sessionFiles.saveFile("conditionDir", "condition-settings.json", JSON.stringify(currentCondition, null, 4));
        }
        else if (viewNext === loopStartViewName && this.state.conditionIndex === 0) {
            const indices = this.estConfig.conditions.random.map((_, counter) => counter);
            for (let counter00 = indices.length - 1; counter00 > 0; counter00--) {
                const counter01 = Math.floor(Math.random() * (counter00 + 1));
                [indices[counter00], indices[counter01]] = [indices[counter01], indices[counter00]];
            }
            this.state.conditionOrder = indices;

            const currentCondition = this.state.conditionIndex === 0 ? this.estConfig.conditions.baseline[0] : this.estConfig.conditions.random[this.state.conditionOrder[this.state.conditionIndex - 1]];
            console.log("[Server] Round " + this.state.conditionIndex + ": Using condition " + JSON.stringify(currentCondition));
            this.sessionFiles.saveFile("conditionDir", "condition-settings.json", JSON.stringify(currentCondition, null, 4));
        }

        if (viewNext === this.views.lstExp) {
            this.state.conditionListeningSpeakingTestIndex = 0;
        }
        if (isFirstLstEval) {
            this.state.conditionListeningSpeakingTestIndex = 1;
        }
        if (isLoopEndView) {
            this.state.conditionListeningSpeakingTestIndex = 0;
        }

        this.clientRegistry.emitToAll("est-event:viewChangeResponse", (clientSocketId) => this.viewFlow.getViewData(viewNext, clientSocketId));
        this.state.gates.viewChange.clear();
        this.state.fileTransferPendingViewName = null;

        if (viewNext === this.views.ending) {
            setTimeout(() => {
                console.log("[Server] Shutting down current server instance due to experiment completion");
                process.exit();
            }, 60000);
        }
    }

    handleFileTransferRequest(socket, data) {
        const payload = data ?? {};

        const client = this.clientRegistry.getBySocketId(socket.id);
        if (!client) {
            this.clientRegistry.logIgnoredEvent(socket, "fileTransferRequest");
            return;
        }

        // Construct filename: client-{a|b}-{sct|lst}-{microphone|headphones}.ogg
        const roundSuffix = payload.testType === "lst" ? "-r" + (this.state.conditionListeningSpeakingTestIndex + 1) : "";
        const serverFilename = "client-" + client.clientLabel + "-" + payload.testType + roundSuffix + "-" + payload.fileName;

        // Write file to current condition directory
        this.sessionFiles.saveFile("conditionDir", serverFilename, Buffer.from(payload.fileData));

        // Gate: Track received files (2 files from 2 clients = 4 total)
        const transferKey = String(this.state.conditionIndex + 1).padStart(4, "0") + ":" + payload.testType + roundSuffix;

        this.state.gates.fileTransfer.add(transferKey + ":" + socket.id + ":" + payload.fileName);

        if (this.state.gates.fileTransfer.size >= 4) {
            this.state.fileTransferCompletedKeys.add(transferKey);
            this.clientRegistry.emitToAll("est-event:fileTransferResponse");

            // Try to resolve any pending double-gated view change
            if (this.state.fileTransferPendingViewName && this.state.gates.viewChange.size === 2) {
                const pendingView = this.viewFlow.viewFlow.find((v) => v.name === this.state.fileTransferPendingViewName);
                const pendingTestType = pendingView?.metadata?.testType;
                const pendingRoundSuffix = pendingTestType === "lst" ? "-r" + (this.state.conditionListeningSpeakingTestIndex + 1) : "";
                const pendingTransferKey = pendingTestType ? String(this.state.conditionIndex + 1).padStart(4, "0") + ":" + pendingTestType + pendingRoundSuffix : null;

                if (pendingTransferKey === transferKey) {
                    this.resolveGatedViewChange(this.state.fileTransferPendingViewName);
                }
            }

            this.state.gates.fileTransfer.clear();
        }
    }
}

module.exports = { ExperimentFlow };
