const express = require("express");

function registerRecordingRoutes(app, { enrollments, transfers, config }) {
    const router = express.Router();
    router.use((request, response, next) => {
        const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
        request.participant = enrollments.authenticate(token);
        if (!request.participant) return response.status(401).json({ error: "Authentication required" });
        next();
    });
    const route = handler => async (request, response) => {
        try { response.json(await handler(request)); }
        catch (error) { response.status(400).json({ error: error.message }); }
    };
    router.post("/", route(request => transfers.begin(request.participant, request.body)));
    router.put("/:id/chunks/:offset", express.raw({ type: "application/octet-stream", limit: config.chunkBytes }), route(request => transfers.append(request.participant, request.params.id, Number(request.params.offset), request.body)));
    router.post("/:id/complete", route(request => transfers.commit(request.participant, request.params.id)));
    app.use("/api/recordings", router);
}
module.exports = { registerRecordingRoutes };
