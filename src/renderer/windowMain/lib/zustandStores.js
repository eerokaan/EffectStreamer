import useStoreSectionBody from "../stores/l0_SectionBody.js";

// Registry of all Zustand stores
const storeRegistry = {
    SectionBody: useStoreSectionBody
};

// Initialize IPC listeners for store communication
const zustandStores = () => {
    if (!window.appApi || !window.appApi.ipcRenderer) {
        console.warn("IPC renderer not available. Store communication won't work.");
        return;
    }

    window.appApi.ipcRenderer.on("storeGetValueRequest", (event, { storeName, key }) => {
        try {
            const store = storeRegistry[storeName];
            if (!store) {
                throw new Error("[ErrorGeneral] Store " + storeName + " not found in registry");
            }

            const state = store.getState();
            if (key === "*") {
                const allPrimitiveStates = Object.entries(state).reduce((accumulator, [key, value]) => {
                    if (typeof value !== "function") {
                        accumulator[key] = value;
                    }
                    return accumulator;
                }, {});
                window.appApi.ipcRenderer.send("storeGetValueResponse", allPrimitiveStates);
            }
            else {
                window.appApi.ipcRenderer.send("storeGetValueResponse", state[key]);
            }
        }
        catch (error) {
            console.error("Error getting value from store " + storeName + " for key " + key + ": " + error);
            window.appApi.ipcRenderer.send("storeGetValueResponse", null);
        }
    });

    window.appApi.ipcRenderer.on("storeSetValueRequest", (event, { storeName, key, value }) => {
        try {
            const store = storeRegistry[storeName];
            if (!store) {
                throw new Error("[ErrorGeneral] Store " + storeName + " not found in registry");
            }

            if (key === "*" && typeof value === "object") {
                const state = store.getState();
                let successStatus = true;

                Object.entries(value).forEach(([setterName, setterValue]) => {
                    if (typeof state[setterName] === "function") {
                        try {
                            state[setterName](setterValue);
                        }
                        catch (error) {
                            console.error("Error calling " + setterName + " with value " + setterValue + ": " + error);
                            successStatus = false;
                        }
                    }
                    else {
                        console.warn(setterName + " is not a function in store " + storeName);
                        successStatus = false;
                    }
                });

                window.appApi.ipcRenderer.send("storeSetValueResponse", successStatus);
            }
            else {
                store.getState()[key](value);
                window.appApi.ipcRenderer.send("storeSetValueResponse", true);
            }
        }
        catch (error) {
            console.error("Error setting value in store " + storeName + " for key " + key + ": " + error);
            window.appApi.ipcRenderer.send("storeSetValueResponse", false);
        }
    });
};

export default zustandStores;
