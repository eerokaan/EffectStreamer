import { createJSONStorage } from "zustand/middleware";

const zustandStorage = createJSONStorage(() => ({
    getItem: async (name) => {
        try {
            const data = await window.appApi.ipcRenderer.invoke("jsonFileRead", name);
            return data;
        }
        catch (error) {
            console.error("Error reading " + name + ".json: " + error);
            return null;
        }
    },

    setItem: async (name, value) => {
        try {
            await window.appApi.ipcRenderer.invoke("jsonFileWrite", name, value);
        }
        catch (error) {
            console.error("Error writing " + name + ".json: " + error);
        }
    },

    removeItem: async (name) => {
        try {
            await window.appApi.ipcRenderer.invoke("jsonFileDelete", name);
        }
        catch (error) {
            console.error("Error deleting " + name + ".json: " + error);
        }
    }
}));

export default zustandStorage;
