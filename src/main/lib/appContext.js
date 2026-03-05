const defaultStates = {
    windowMain: null,
    socket: null
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
