import { create } from "zustand";
import { persist } from "zustand/middleware";
import zustandStorage from "@/lib/zustandStorage";

const defaultStates = {
    dialogOpen: false,
    dialogTitle: "Dialog Title",
    dialogDescription: "Dialog Description",
    dialogButton: "Okay"
};

const useStoreSectionBody = create(
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
            name: "SectionBody",
            storage: zustandStorage
        }
    )
);

export default useStoreSectionBody;
