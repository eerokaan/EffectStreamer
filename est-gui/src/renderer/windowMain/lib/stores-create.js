import { create } from "zustand";

// Creates a Zustand store with programmatically generated set actions
const createStore = (defaultStates) =>
    create((set) => {
        const setActions = Object.entries(defaultStates).reduce((accumulator, [key]) => {
            const setterName = "set" + key.charAt(0).toUpperCase() + key.slice(1);
            accumulator[setterName] = (newValue) => set({ [key]: newValue });
            return accumulator;
        }, {});

        return {
            ...defaultStates,
            ...setActions,
            resetStates: () => set(defaultStates)
        };
    });

export default createStore;
