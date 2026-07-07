const { spawn } = require("child_process");
const { loadConfig } = require("./bootstraps/configManager.js");

class Harness {
    constructor() {
        this.childProcess = null;
    }

    run() {
        console.log("[Harness] Harness started");
        this.spawnServer();

        process.on("SIGINT", () => {
            if (this.childProcess) this.childProcess.kill("SIGINT");
            process.exit(0);
        });
        process.on("SIGTERM", () => {
            if (this.childProcess) this.childProcess.kill("SIGTERM");
            process.exit(0);
        });
    }

    spawnServer() {
        this.validateConfigBeforeStart();
        console.log("[Harness] Starting server instance");

        this.childProcess = spawn(process.execPath, process.argv.slice(1), {
            stdio: "inherit",
            env: { ...process.env, EST_SERVER_TYPE: "server" }
        });
        this.childProcess.on("exit", (code, signal) => {
            if (signal === "SIGINT" || signal === "SIGTERM") {
                console.log("[Harness] Server instance killed by " + signal + ". Exiting harness");
                process.exit(0);
            }

            console.log("[Harness] Server instance exited (code: " + code + ") - Restarting in 500ms");
            setTimeout(() => this.spawnServer(), 500);
        });
    }

    validateConfigBeforeStart() {
        try {
            loadConfig();
        }
        catch (error) {
            console.error("[Harness] Failed to load and validate config: " + error.message);
            process.exit(1);
        }
    }
}

module.exports = { Harness };
