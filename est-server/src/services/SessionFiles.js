const os = require("os");
const path = require("path");
const fs = require("fs");
const { formatConditionDirName, formatSessionDirName, parseSessionDirNumber } = require("../utils/format.js");
const { isSafeFilename } = require("../utils/filenames.js");

class SessionFiles {
    // prettier-ignore
    constructor({
        state,
        config
    }) {
        this.state = state;
        this.config = config;
    }

    createFolderStructure() {
        // Create the effectstreamer base directory
        const effectstreamerDir = path.join(os.homedir(), "effectstreamer");
        fs.mkdirSync(effectstreamerDir, { recursive: true });

        // Determine next session number (n+1 from existing directories) and create directory
        const existing = fs
            .readdirSync(effectstreamerDir)
            .map(parseSessionDirNumber)
            .filter((number) => number != null);
        const sessionNumber = existing.length > 0 ? Math.max(...existing) + 1 : 1;

        this.state.sessionDir = path.join(effectstreamerDir, formatSessionDirName(sessionNumber));
        fs.mkdirSync(this.state.sessionDir);

        // Create condition directories
        const roundsTotal = this.config.conditions.baseline.length + this.config.conditions.random.length;
        for (let counter = 1; counter <= roundsTotal; counter++) {
            fs.mkdirSync(path.join(this.state.sessionDir, formatConditionDirName(counter)));
        }
    }

    saveFile(location, filename, data, conditionIndex = this.state.conditionIndex) {
        // Reject writes without an initialized session directory
        if (!this.state.sessionDir) {
            throw new Error("Session directory is not initialized");
        }

        // Reject unsafe file names
        if (!isSafeFilename(filename)) {
            throw new Error("Unsafe session filename: " + filename);
        }

        // Determine the destination directory for the supplied location
        const conditionDirName = formatConditionDirName(conditionIndex + 1);
        let destinationDir = null;

        if (location === "sessionDir") destinationDir = this.state.sessionDir;
        else if (location === "conditionDir") destinationDir = path.join(this.state.sessionDir, conditionDirName);
        else throw new Error("Unknown session file location: " + location);

        // Reject destinations that resolve outside the session directory
        const resolvedSessionDir = fs.realpathSync(this.state.sessionDir);
        const resolvedDestinationDir = fs.realpathSync(destinationDir);
        if (resolvedDestinationDir !== resolvedSessionDir && !resolvedDestinationDir.startsWith(resolvedSessionDir + path.sep)) {
            throw new Error("Session file destination resolves outside session directory");
        }

        // Reject file names that resolve outside the destination directory
        const filePath = path.resolve(resolvedDestinationDir, filename);
        if (path.dirname(filePath) !== resolvedDestinationDir) {
            throw new Error("Session filename resolves outside destination: " + filename);
        }

        // Write the file atomically through a temporary file
        const temporaryPath = filePath + ".tmp-" + process.pid;
        try {
            fs.writeFileSync(temporaryPath, data);
            fs.renameSync(temporaryPath, filePath);
        }
        catch (error) {
            try {
                fs.rmSync(temporaryPath, { force: true });
            }
            catch (cleanupError) {
                throw new Error(error.message + "; failed to remove temporary file: " + cleanupError.message);
            }
            throw error;
        }
    }
}

module.exports = { SessionFiles };
