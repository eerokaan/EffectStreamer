const { Harness } = require("./harness.js");
const { loadConfig } = require("./bootstraps/configManager.js");

if (process.env.EST_SERVER_TYPE === "harness") new Harness().run();
else if (process.env.EST_SERVER_TYPE === "server") {
    try {
        const config = loadConfig();
        const { createCoordinator } = require("./server.js");
        const coordinator = createCoordinator({ config });
        coordinator.server.listen(config.server.port, config.server.ipAddress, () => console.log("[Server] Listening on " + config.server.ipAddress + ":" + config.server.port));
        for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void coordinator.close().then(() => process.exit(0)); });
    }
    catch (error) { console.error("[Server] " + error.message); process.exitCode = 1; }
}
else { console.error("EST_SERVER_TYPE must be harness or server"); process.exitCode = 1; }
