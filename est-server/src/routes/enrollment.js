const net = require("node:net");
const { publicBootstrap } = require("../bootstraps/configManager.js");

function registerEnrollmentRoutes(app, { config, enrollments }) {
    app.get("/api/config", (_request, response) => response.json(publicBootstrap(config)));
    app.post("/api/enrollment", (request, response) => {
        try {
            const { identity, ipAddress, operatingSystem } = request.body || {};
            if (config.deployment.mode === "remote" && !config.deployment.allowDevelopmentAdmission) return response.status(403).json({ error: "Recruitment admission is required" });
            if (config.deployment.mode === "local" && !["client-a", "client-b"].includes(identity)) return response.status(403).json({ error: "Unknown configured local identity" });
            if (config.deployment.mode === "local" && (!net.isIP(ipAddress || "") || !["linux", "windows"].includes(operatingSystem))) return response.status(400).json({ error: "Native client address and operating system required" });
            response.status(201).json(enrollments.admit({ identity, ipAddress, operatingSystem }));
        }
        catch (error) { response.status(409).json({ error: error.message }); }
    });
}
module.exports = { registerEnrollmentRoutes };
