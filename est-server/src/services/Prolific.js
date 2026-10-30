const { createHash } = require("node:crypto");
function assertDesktop(device = {}) {
    const agent = device.userAgent || "", platform = device.platform || "";
    if (device.mobile === true || /android|iphone|ipad|ipod|mobile|tablet|kindle|silk/i.test(agent) || ((/MacIntel/i.test(platform) || /Macintosh/i.test(agent)) && Number(device.maxTouchPoints) > 1)) throw new Error("Use a desktop or laptop; phones and tablets are not supported");
}
function recruitmentIds(query) {
    for (const key of ["PROLIFIC_PID", "STUDY_ID", "SESSION_ID"]) if (typeof query[key] !== "string" || !query[key].trim() || query[key].length > 256) throw new Error("Missing or invalid Prolific identifier: " + key);
    return { prolificPid: query.PROLIFIC_PID, studyId: query.STUDY_ID, submissionId: query.SESSION_ID };
}
class Prolific {
    constructor({ config, enrollments, getSession, jwks, now = Date.now }) {
        this.config = config;this.enrollments = enrollments;this.getSession = getSession;this.jwks = jwks;this.now = now;
    }
    async verifyToken(token, query) {
        if (typeof token !== "string" || token.length > 16384) throw new Error("A Prolific secured URL token is required");
        const jose = await import("jose");
        this.keys ||= this.jwks ? jose.createLocalJWKSet(this.jwks) : jose.createRemoteJWKSet(new URL("https://api.prolific.com/.well-known/study/jwks.json"), { timeoutDuration: 5000, cacheMaxAge: 86400000 });
        const { payload } = await jose.jwtVerify(token, this.keys, { algorithms: ["RS256"], issuer: "https://www.prolific.com", requiredClaims: ["iat", "exp", "aud", "sub", "prolific"], currentDate: new Date(this.now()) });
        const expected = new URL(this.config.prolific.externalStudyUrl);
        let audience;try {audience = new URL(payload.aud);} catch {throw new Error("Invalid secured URL audience");}
        if (audience.origin !== expected.origin || audience.pathname !== expected.pathname || audience.username || audience.password || audience.hash) throw new Error("Secured URL audience does not match this study");
        if (payload.iat > Math.floor(this.now() / 1000) + 30 || payload.exp - payload.iat > 180 || payload.exp <= payload.iat) throw new Error("Invalid secured URL token lifetime");
        const claims = payload.prolific;
        if (!claims || claims.workspace_id !== this.config.prolific.workspaceId || (claims.organisation_id || null) !== this.config.prolific.organisationId) throw new Error("Secured URL workspace/organisation claim mismatch");
        for (const key of ["PROLIFIC_PID", "STUDY_ID", "SESSION_ID"]) if (claims[key] !== query[key]) throw new Error("Secured URL identifier claim does not match query");
        if (payload.sub !== query.SESSION_ID) throw new Error("Secured URL subject claim does not match submission");
        for (const [key, value] of audience.searchParams) if (query[key] !== value || claims[key] !== value) throw new Error("Secured URL query does not match signed audience claims");
        for (const [key, value] of expected.searchParams) if (query[key] !== value || claims[key] !== value) throw new Error("Configured study query claim mismatch");
        return true;
    }
    async enroll({ query = {}, device = {} }) {
        assertDesktop(device);
        const recruitment = recruitmentIds(query);
        if (recruitment.studyId !== this.config.prolific.studyId) throw new Error("Wrong Prolific study");
        const token = query.prolific_token || query.PROLIFIC_TOKEN;
        recruitment.verified = this.config.prolific.secureUrls ? await this.verifyToken(token, query) : false;
        const identity = "prolific-" + createHash("sha256").update(recruitment.studyId + "\0" + recruitment.submissionId).digest("hex");
        return this.enrollments.admit({ identity, recruitment });
    }
    expireWaiting() {
        let changed = false;
        for (const person of this.enrollments.participants.values()) if (!person.sessionId && !person.outcome && person.readyAt != null && this.now() > person.readyAt + this.config.sessions.pairingTimeoutMs) {
            person.outcome = "waitingTimeout";person.currentView = "viewEnding";person.revision = (person.revision || 0) + 1;changed = true;
        }
        if (changed) this.enrollments.save();return changed;
    }
    completionData(participantId) {
        const person = this.enrollments.get(participantId);if (!person) throw new Error("Unknown participant");
        const session = this.getSession(participantId), outcome = session?.outcome || person.outcome;
        if (!outcome || !["completed", "technicalFailure", "partnerLeft", "waitingTimeout"].includes(outcome)) throw new Error("Completion is not available");
        if (outcome === "completed" && (!session || !session.completionReady())) throw new Error("Required responses and recordings are not complete");
        if (!this.config.prolific.enabled || !person.recruitment) return { outcome, code: null, url: null };
        const code = this.config.prolific.completionCodes[outcome];
        return { url: "https://app.prolific.com/submissions/complete?cc=" + encodeURIComponent(code), code, outcome };
    }
    async completion(participantId) { return this.completionData(participantId); }
    previewCompletion(participantId) { try {return this.completionData(participantId);} catch {return null;} }
}
module.exports = { Prolific, assertDesktop };
