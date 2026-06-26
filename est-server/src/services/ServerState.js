class ServerState {
    constructor() {
        this.sessionDir = null;
        this.shutdownScheduled = false;
        this.clientsData = new Map();
        this.clientsSocketRegistry = new Map();
        this.resetExperimentSession();
    }

    resetExperimentSession() {
        this.conditionIndex = 0;
        this.conditionOrder = [];
        this.conditionListeningSpeakingTestIndex = 0;
        this.fileTransferCompletedKeys = new Set();
        this.fileTransferPendingViewName = null;
        this.coreStopCompletedKeys = new Set();
        this.gates = {
            viewChange: new Set(),
            coreStart: new Set(),
            fileTransfer: new Set()
        };
    }
}

module.exports = { ServerState };
