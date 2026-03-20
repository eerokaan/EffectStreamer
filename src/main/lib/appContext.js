const defaultStates = {
    windowMain: null,
    socket: null,
    estCoreSender: null,
    estCoreReceiver: null
};

const appContext = {
    // Initial states
    ...defaultStates,

    // Reset all states
    resetStates() {
        Object.keys(defaultStates)
            .forEach((key) => {
                this[key] = defaultStates[key];
            });
    }
};

export default appContext;
