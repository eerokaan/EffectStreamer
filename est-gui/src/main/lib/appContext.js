const defaultStates = {
    windowMain: null,
    socket: null,
    config: null,
    configPath: null,
    audioDevices: null,
    audioTransport: null,
    estCoreContextKey: null,
    isClosing: false
};

const appContext = {
    // Initial states
    ...defaultStates,

    // Reset all states
    resetStates() {
        Object.keys(defaultStates).forEach((key) => {
            this[key] = defaultStates[key];
        });
    }
};

export default appContext;
