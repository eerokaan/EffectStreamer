const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID, createHash } = require("node:crypto");

function tokenHash(token) { return createHash("sha256").update(token).digest("hex"); }

class EnrollmentStore {
    constructor(root) {
        fs.mkdirSync(root, { recursive: true });
        this.file = path.join(root, "enrollments.json");
        this.participants = new Map();
        if (fs.existsSync(this.file)) {
            for (const participant of JSON.parse(fs.readFileSync(this.file, "utf8"))) this.participants.set(participant.participantId, participant);
        }
    }

    admit({ identity, ipAddress = null, operatingSystem = null, recruitment = null }) {
        if (typeof identity !== "string" || !identity.trim() || identity.length > 256) throw new Error("Invalid enrollment identity");
        if ([...this.participants.values()].some(participant => participant.identity === identity)) throw new Error("Submission already enrolled; use reconnect credentials");
        const reconnectToken = randomBytes(32).toString("base64url");
        const participant = {
            participantId: randomUUID(), identity, ipAddress, operatingSystem, recruitment,
            tokenHash: tokenHash(reconnectToken), sessionId: null, setupComplete: false, pretestComplete: false, outcome: null,
            currentView: "viewWelcome", revision: 0, readyAt: null, readyOrder: null
        };
        this.participants.set(participant.participantId, participant);
        try { this.save(); }
        catch (error) { this.participants.delete(participant.participantId); throw error; }
        return { participantId: participant.participantId, reconnectToken };
    }

    authenticate(token) {
        if (typeof token !== "string" || token.length < 32 || token.length > 256) return null;
        const digest = tokenHash(token);
        return [...this.participants.values()].find(participant => participant.tokenHash === digest) || null;
    }

    get(id) { return this.participants.get(id); }

    ready(id, now = Date.now()) {
        const person = this.get(id);
        if (!person || person.sessionId || person.outcome || !person.setupComplete || !person.pretestComplete) throw new Error("Complete setup and pretest before joining the queue");
        if (person.readyOrder == null) {
            person.readyAt = now;person.readyOrder = 1 + Math.max(0, ...[...this.participants.values()].map(person => person.readyOrder || 0));
            this.save();
        }
        return person;
    }
    nextPair(eligible = () => true) {
        return [...this.participants.values()].filter(person => !person.sessionId && !person.outcome && person.readyOrder != null && person.setupComplete && person.pretestComplete && eligible(person)).sort((a, b) => a.readyOrder - b.readyOrder).slice(0, 2);
    }

    save() {
        const temporary = this.file + ".tmp-" + randomUUID();
        let file;
        try {
            file = fs.openSync(temporary, "wx", 0o600);
            fs.writeFileSync(file, JSON.stringify([...this.participants.values()], null, 4) + "\n");
            fs.fsyncSync(file); fs.closeSync(file); file = undefined;
            fs.renameSync(temporary, this.file);
        }
        catch (error) {
            if (file !== undefined) fs.closeSync(file);
            fs.rmSync(temporary, { force: true });
            throw error;
        }
    }
}
module.exports = { EnrollmentStore };
