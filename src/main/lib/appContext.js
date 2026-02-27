const defaultStates = {
    windowMain: null,
    contextValue00: 0,
    contextValue01: false,
    contextValue02: null
};

const appContext = {
    // Initial states
    ...defaultStates,

    // Reset all states
    resetStates() {
        Object.keys(defaultStates)
            .filter((key) => key.startsWith("state") || key.startsWith("memory"))
            .forEach((key) => {
                this[key] = defaultStates[key];
            });
    }
};

export default appContext;
