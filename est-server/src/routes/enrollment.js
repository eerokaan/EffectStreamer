const net = require("node:net");
const { publicBootstrap } = require("../bootstraps/configManager.js");

function registerEnrollmentRoutes(app, { config, enrollments, prolific }) {
    app.get("/api/config", (_request, response) => response.json(publicBootstrap(config)));
    app.post("/api/enrollment", async (request, response) => {
        try {
            const { identity, ipAddress, operatingSystem } = request.body || {};
            const device = { ...request.body?.device, userAgent: request.headers["user-agent"] || "" };
            if (config.deployment.mode === "remote") {
                require("../services/Prolific.js").assertDesktop(device);
                prolific.expireWaiting();
                if ([...enrollments.participants.values()].filter((person) => !person.sessionId && !person.outcome).length >= config.sessions.maxWaitingParticipants) return response.status(503).json({ error: "Study admission capacity reached; try again later" });
                if (config.prolific.enabled) return response.status(201).json(await prolific.enroll({ query: request.body?.query, device }));
            }
            if (config.deployment.mode === "remote") return response.status(403).json({ error: "Recruitment admission is required" });
            if (config.deployment.mode === "local" && !["client-a", "client-b"].includes(identity)) return response.status(403).json({ error: "Unknown configured local identity" });
            if (config.deployment.mode === "local" && (!net.isIP(ipAddress || "") || !["linux", "windows"].includes(operatingSystem))) return response.status(400).json({ error: "Native client address and operating system required" });
            let allowTerminalIdentity = false;
            if (config.deployment.mode === "local" && request.body.reconnectToken) {
                const previous = enrollments.authenticate(request.body.reconnectToken);
                if (!previous || previous.identity !== identity || previous.recruitment) throw new Error("Invalid local reconnect credentials");
                if (!previous.outcome) return response.status(201).json({ participantId: previous.participantId, reconnectToken: request.body.reconnectToken });
                // A new local launch may reuse the machine label, never the old
                // participant/session. Old credentials still own the old results.
                allowTerminalIdentity = true;
            }
            response.status(201).json(enrollments.admit({ identity, ipAddress, operatingSystem }, { allowTerminalIdentity }));
        }
        catch (error) {
            response.status(409).json({ error: error.message });
        }
    });
    app.get("/api/completion", async (request, response) => {
        const person = enrollments.authenticate(request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1]);
        if (!person) return response.status(401).json({ error: "Authentication required" });
        try {
            response.json(await prolific.completion(person.participantId));
        }
        catch (error) {
            response.status(409).json({ error: error.message });
        }
    });
}
module.exports = { registerEnrollmentRoutes };
