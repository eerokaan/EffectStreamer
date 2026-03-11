import useStoreRoot from "@/stores/root";

const stores = () => {
    if (!window.appApi || !window.appApi.ipcRenderer) {
        console.warn("IPC renderer not available. Store communication won't work.");
        return;
    }
    
    window.appApi.ipcRenderer.on("ipc:sessionStart", () => {
        useStoreRoot.getState().setCurrentView("viewWelcome");
    });
    window.appApi.ipcRenderer.on("ipc:sessionEnd", () => {
        useStoreRoot.getState().setCurrentView("viewWaiting");
    });
};

export default stores;