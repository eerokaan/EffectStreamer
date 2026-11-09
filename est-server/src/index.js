const path=require('node:path');
const {isSea}=require('node:sea');
const {createTransientPaths}=require('@effectstreamer/common/transient-paths');
Object.assign(process.env,createTransientPaths({anchor:isSea()?path.dirname(process.execPath):path.resolve(__dirname,'../..')}).environment('est-server'));
const { Harness } = require("./harness.js");
const { loadConfig } = require("./bootstraps/configManager.js");

if (process.env.EST_SERVER_TYPE === "media-worker") require("./media/MediaWorker.js").runMediaWorker();
else if (process.env.EST_SERVER_TYPE === "harness") new Harness().run();
else if (process.env.EST_SERVER_TYPE === "server") {
    try {
        const config = loadConfig();
        const { createCoordinator } = require("./server.js");
        const coordinator = createCoordinator(require('./bootstraps/resources.js').resources(config));
        void coordinator.ready.then(() => coordinator.server.listen(config.server.port, config.server.ipAddress, () => console.log("[Server] Listening on " + config.server.ipAddress + ":" + config.server.port))).catch(error => {console.error("[Server] Recovery failed: " + error.message);process.exitCode = 1;});
        for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void coordinator.close().then(() => process.exit(0)); });
    }
    catch (error) { console.error("[Server] " + error.message); process.exitCode = 1; }
}
else { console.error("EST_SERVER_TYPE must be harness, server or media-worker"); process.exitCode = 1; }
