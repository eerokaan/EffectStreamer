import useStoreRoot from "@/stores/root";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreComponentScale from "@/stores/component-scale";

// Registry of all Zustand stores
const storeRegistry = {
    Root: useStoreRoot,
    ComponentFooter: useStoreComponentFooter,
    ComponentScale: useStoreComponentScale
};

// Initialize IPC gateway, so that Zustand stores are accessible via IPC calls
const storesIpcGateway = () => {
    if (!window.appApi || !window.appApi.ipcRenderer) {
        console.warn("IPC renderer not available. Store communication won't work.");
        return;
    }

    // Read from Zustand stores
    window.appApi.ipcRenderer.on("ipc:storeGetValueRequest", (_, { storeName, payload }) => {
        try {
            // Get Zustand store
            const store = storeRegistry[storeName];
            if (!store) {
                throw new Error("[ErrorGeneral] Store " + storeName + " not found in registry");
            }

            // Getting logic
            const state = store.getState();
            const values = payload.map((attrName) => state[attrName]);

            // Send response back to caller
            window.appApi.ipcRenderer.send("ipc:storeGetValueResponse", values);
        }
        catch (error) {
            console.error("Error getting value from store " + storeName + ": " + error);
            window.appApi.ipcRenderer.send("ipc:storeGetValueResponse", null);
        }
    });

    // Write to Zustand stores
    window.appApi.ipcRenderer.on("ipc:storeSetValueRequest", (_, { storeName, payload }) => {
        try {
            // Get Zustand store
            const store = storeRegistry[storeName];
            if (!store) {
                throw new Error("[ErrorGeneral] Store " + storeName + " not found in registry");
            }

            // Setting logic
            store.setState(payload);

            // Send response back to caller
            window.appApi.ipcRenderer.send("ipc:storeSetValueResponse", true);
        }
        catch (error) {
            console.error("Error setting value in store " + storeName + ": " + error);
            window.appApi.ipcRenderer.send("ipc:storeSetValueResponse", false);
        }
    });

    // Reset Zustand stores
    window.appApi.ipcRenderer.on("ipc:storeResetRequest", (_, { storeName }) => {
        try {
            // Get Zustand store
            const store = storeRegistry[storeName];
            if (!store) {
                throw new Error("[ErrorGeneral] Store " + storeName + " not found in registry");
            }

            // Call resetStates method
            store.getState().resetStates();

            // Send response back to caller
            window.appApi.ipcRenderer.send("ipc:storeResetResponse", true);
        }
        catch (error) {
            console.error("Error calling resetStates on store " + storeName + ": " + error);
            window.appApi.ipcRenderer.send("ipc:storeResetResponse", false);
        }
    });
};

export default storesIpcGateway;
