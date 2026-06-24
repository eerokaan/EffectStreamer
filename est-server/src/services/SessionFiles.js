const os = require("os");
const path = require("path");
const fs = require("fs");

class SessionFiles {
    constructor({ state, estConfig }) {
        this.state = state;
        this.estConfig = estConfig;
    }

    createFolderStructure() {
        const effectstreamerDir = path.join(os.homedir(), "effectstreamer");
        fs.mkdirSync(effectstreamerDir, { recursive: true });

        // Determine next session number (n+1 from existing directories)
        const existing = fs
            .readdirSync(effectstreamerDir)
            .filter((name) => /^session_\d{4}$/.test(name))
            .map((name) => Number(name.slice("session_".length)));
        const sessionNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;

        this.state.sessionDir = path.join(effectstreamerDir, "session_" + String(sessionNum).padStart(4, "0"));
        fs.mkdirSync(this.state.sessionDir);

        // Create condition directories
        const roundsTotal = this.estConfig.conditions.baseline.length + this.estConfig.conditions.random.length;
        for (let counter = 1; counter <= roundsTotal; counter++) {
            fs.mkdirSync(path.join(this.state.sessionDir, "condition_" + String(counter).padStart(4, "0")));
        }
    }

    saveFile(location, filename, data) {
        const conditionDirName = "condition_" + String(this.state.conditionIndex + 1).padStart(4, "0");

        let filePath = null;
        if (location === "sessionDir") {
            filePath = path.join(this.state.sessionDir, filename);
        }
        else if (location === "conditionDir") {
            filePath = path.join(this.state.sessionDir, conditionDirName, filename);
        }
        else {
            throw new Error("Unknown session file location: " + location);
        }

        fs.writeFileSync(filePath, data);
    }
}

module.exports = { SessionFiles };
