class ServerState {
    // prettier-ignore
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
        this.recordingContextActive = null;
        this.recordingContexts = new Map();
        this.gates = {
            viewChange: new Set()
        };
    }
}

module.exports = { ServerState };
