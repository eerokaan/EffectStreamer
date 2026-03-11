import { create } from "zustand";

const useStoreRoot = create((set) => ({
    currentView: "viewWaiting",
    setCurrentView: (view) => set({ currentView: view }),
}));

export default useStoreRoot;