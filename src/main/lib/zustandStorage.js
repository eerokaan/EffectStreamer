import { app, ipcMain } from "electron";
import fs from "fs";
import path from "path";

// Get the path to store JSON files
const userDataPath = app.getPath("userData");
const storesPath = path.join(userDataPath, "stores");

// Set up IPC handlers
const zustandStorage = () => {
    if (!fs.existsSync(storesPath)) {
        fs.mkdirSync(storesPath, { recursive: true });
    }

    ipcMain.handle("jsonFileRead", async (_, name) => {
        const filePath = path.join(storesPath, name + ".json");

        try {
            if (fs.existsSync(filePath)) {
                const data = await fs.promises.readFile(filePath, "utf8");
                return JSON.parse(data);
            }
            return null;
        }
        catch (error) {
            console.error("Error reading file " + filePath + ": " + error);
            return null;
        }
    });

    ipcMain.handle("jsonFileWrite", async (_, name, content) => {
        const filePath = path.join(storesPath, name + ".json");

        try {
            await fs.promises.writeFile(filePath, JSON.stringify(content), "utf8");
            return true;
        }
        catch (error) {
            console.error("Error writing file " + filePath + ": " + error);
            return false;
        }
    });

    ipcMain.handle("jsonFileDelete", async (_, name) => {
        const filePath = path.join(storesPath, name + ".json");

        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
            return true;
        }
        catch (error) {
            console.error("Error deleting file " + filePath + ": " + error);
            return false;
        }
    });
};

export default zustandStorage;
