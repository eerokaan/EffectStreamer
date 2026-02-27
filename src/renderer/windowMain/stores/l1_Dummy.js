import { create } from "zustand";
import { persist } from "zustand/middleware";
import zustandStorage from "@/lib/zustandStorage";

const defaultStates = {
    inputText: ""
};

const useStoreDummy = create(
    persist(
        (set) => ({
            // Initial states
            ...defaultStates,

            // Action to update states
            updateStates: (updates) => set(updates),

            // Reset all states
            resetStates: () => set(defaultStates)
        }),
        {
            name: "Dummy",
            storage: zustandStorage
        }
    )
);

export default useStoreDummy;
