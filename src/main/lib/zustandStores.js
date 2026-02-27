import { ipcMain } from "electron";

const zustandStores = (windowMain) => {
    return {
        getStoreValue: async (storeName, key) => {
            if (windowMain) {
                try {
                    windowMain.webContents.send("storeGetValueRequest", { storeName, key });

                    return new Promise((resolve) => {
                        ipcMain.once("storeGetValueResponse", (_, result) => {
                            resolve(result);
                        });
                    });
                }
                catch (error) {
                    console.error("Failed to get value from store " + storeName + " for key " + key + ": " + error);
                    return null;
                }
            }
            return null;
        },

        setStoreValue: async (storeName, key, value) => {
            if (windowMain) {
                try {
                    windowMain.webContents.send("storeSetValueRequest", { storeName, key, value });

                    return new Promise((resolve) => {
                        ipcMain.once("storeSetValueResponse", (_, result) => {
                            resolve(result);
                        });
                    });
                }
                catch (error) {
                    console.error("Failed to set value in store " + storeName + " for key " + key + ": " + error);
                    return false;
                }
            }
            return false;
        }
    };
};

export default zustandStores;
