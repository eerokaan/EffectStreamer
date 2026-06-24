class EffectStreamerCore {
    constructor({ state, estConfig, testConfigKeys, clientRegistry }) {
        this.state = state;
        this.estConfig = estConfig;
        this.testConfigKeys = testConfigKeys;
        this.clientRegistry = clientRegistry;
    }

    handleCoreStartRequest(socket, data) {
        const payload = data ?? {};

        const thisClient = this.clientRegistry.getBySocketId(socket.id);
        if (!thisClient) {
            this.clientRegistry.logIgnoredEvent(socket, "coreStartRequest");
            return;
        }

        const coreRunSuffix = payload.testType === "lst" ? "-r" + (this.state.conditionListeningSpeakingTestIndex + 1) : "";
        const coreRunKey = this.testConfigKeys[payload.testType] ? String(this.state.conditionIndex + 1).padStart(4, "0") + ":" + payload.testType + coreRunSuffix : null;
        if (!coreRunKey) {
            this.clientRegistry.logIgnoredEvent(socket, "coreStartRequest", "The supplied test type is unknown");
            return;
        }
        if (this.state.coreStopCompletedKeys.has(coreRunKey)) {
            this.clientRegistry.logIgnoredEvent(socket, "coreStartRequest", "est-core is already stopped");
            return;
        }

        const currentCondition = this.state.conditionIndex === 0 ? this.estConfig.conditions.baseline[0] : this.estConfig.conditions.random[this.state.conditionOrder[this.state.conditionIndex - 1]];

        // Stage 1: Sender component (Direct response)
        if (payload.component === "sender") {
            let peerClient = null;
            for (const registeredClient of this.state.clientsData.values()) {
                if (registeredClient.clientId !== thisClient.clientId) {
                    peerClient = registeredClient;
                    break;
                }
            }

            if (!peerClient) {
                this.clientRegistry.logIgnoredEvent(socket, "coreStartRequest", "No peer is registered yet");
                return;
            }

            const estCoreSettings = {
                component: "sender",
                testType: payload.testType,
                peerIp: peerClient?.ipAddress,
                deviceSource: thisClient.deviceSource,
                nativeDelay: currentCondition.nativeDelay,
                echoDelay: currentCondition.echoDelay,
                packetlossType: currentCondition.packetlossType,
                packetlossRatio: currentCondition.packetlossRatio,
                packetlossSeed: currentCondition.packetlossSeed,
                packetlossBurstModel: currentCondition.packetlossBurstModel,
                packetlossBurstRatio: currentCondition.packetlossBurstRatio
            };
            this.clientRegistry.emitToSocket(socket.id, "est-event:coreStartResponse", estCoreSettings);
        }

        // Stage 2: Receiver component (Gated response)
        else if (payload.component === "receiver") {
            this.state.gates.coreStart.add(socket.id);

            if (this.state.gates.coreStart.size >= 2) {
                this.clientRegistry.emitToAll("est-event:coreStartResponse", (clientSocketId, clientData) => ({
                    component: "receiver",
                    deviceSink: clientData.deviceSink,
                    nativeGain: currentCondition.nativeGain,
                    echoGain: currentCondition.echoGain
                }));
                this.state.gates.coreStart.clear();
            }
        }
    }

    handleCoreStopRequest(socket, data) {
        const payload = data ?? {};

        const client = this.clientRegistry.getBySocketId(socket.id);
        if (!client) {
            this.clientRegistry.logIgnoredEvent(socket, "coreStopRequest", "The client is not registered (anymore)");
            return;
        }

        const coreRunSuffix = payload.testType === "lst" ? "-r" + (this.state.conditionListeningSpeakingTestIndex + 1) : "";
        const coreRunKey = this.testConfigKeys[payload.testType] ? String(this.state.conditionIndex + 1).padStart(4, "0") + ":" + payload.testType + coreRunSuffix : null;
        if (!coreRunKey) {
            this.clientRegistry.logIgnoredEvent(socket, "coreStopRequest", "The supplied test type is unknown");
            return;
        }

        if (this.state.coreStopCompletedKeys.has(coreRunKey)) return;
        this.state.coreStopCompletedKeys.add(coreRunKey);

        this.state.gates.coreStart.clear();
        this.clientRegistry.emitToAll("est-event:coreStopResponse", { testType: payload.testType, upload: true });
    }
}

module.exports = { EffectStreamerCore };
