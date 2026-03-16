import useStoreRoot from "@/stores/root";
import useStoreComponentFooter from "@/stores/component-footer";

// Registry of all Zustand stores
const storeRegistry = {
    Root: useStoreRoot,
    ComponentFooter: useStoreComponentFooter
};

// Initialize IPC gateway, so that Zustand stores are accessible via IPC calls
const storesIpcGateway = () => {
    if (!window.appApi || !window.appApi.ipcRenderer) {
        console.warn("IPC renderer not available. Store communication won't work.");
        return;
    }

    window.appApi.ipcRenderer.on("ipc:storeGetValueRequest", (event, { storeName, payload }) => {
        try {
            // Get Zustand store
            const store = storeRegistry[storeName];
            if (!store) {
                throw new Error("[ErrorGeneral] Store " + storeName + " not found in registry");
            }

            // Getting logic
            const state = store.getState();
            const values = payload.map(attrName => state[attrName]);

            // Send response back to caller
            window.appApi.ipcRenderer.send("ipc:storeGetValueResponse", values);
        }
        catch (error) {
            console.error("Error getting value from store " + storeName + ": " + error);
            window.appApi.ipcRenderer.send("ipc:storeGetValueResponse", null);
        }
    });

    window.appApi.ipcRenderer.on("ipc:storeSetValueRequest", (event, { storeName, payload }) => {
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
};

export default storesIpcGateway;