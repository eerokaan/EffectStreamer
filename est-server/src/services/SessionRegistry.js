const { ExperimentSession } = require("./ExperimentSession.js");
const { SessionStore } = require("./SessionStore.js");
const { PortAllocator } = require("../media/PortAllocator.js");

class SessionRegistry {
    constructor({ config, io, root, enrollments }) {
        this.config = config; this.io = io; this.root = root; this.enrollments = enrollments;
        this.sessions = new Map(); this.membership = new Map();
        this.store = new SessionStore(root);
        this.ports = new PortAllocator(config.remote.internalPortRange);
    }

    createPair(participants) {
        if (participants.length !== 2 || participants.some(participant => !participant)) throw new Error("A session requires exactly two participants");
        const ids = participants.map(participant => participant.participantId);
        if (new Set(ids).size !== 2 || ids.some(id => this.membership.has(id))) throw new Error("Participant already paired");
        if ([...this.sessions.values()].filter(session => session.phase !== "ended").length >= this.config.deployment.maxActivePairs) throw new Error("Pair capacity reached");
        const session = new ExperimentSession({ participants, config: this.config, io: this.io, root: this.root, store: this.store, enrollments: this.enrollments, allocator: this.ports, onChange: () => this.onChange?.() });
        session.prolific = this.prolific;
        session.transfers = this.transfers;
        session.recoveryPolicy = this.recovery;
        this.sessions.set(session.sessionId, session);
        for (const participant of participants) {this.membership.set(participant.participantId, session.sessionId);participant.sessionId = session.sessionId;}
        this.enrollments.save();
        // Serialized persistence is also awaited by actions/loadAll before reporting successful state.
        session.persist().catch(error => {session.persistenceError = error;});
        return session;
    }

    getForParticipant(id) { return this.sessions.get(this.membership.get(id)); }

    restore(manifest) {
        const participants = manifest.participants.map(client => this.enrollments.get(client.participantId));
        if (participants.length !== 2 || participants.some(person => !person || person.sessionId !== manifest.sessionId)) throw new Error("Invalid persisted session membership");
        const session = new ExperimentSession({ participants, config: this.config, io: this.io, root: this.root, store: this.store, enrollments: this.enrollments, allocator: this.ports, restored: manifest, onChange: () => this.onChange?.() });
        session.transfers = this.transfers;session.prolific = this.prolific;session.recoveryPolicy = this.recovery;
        this.sessions.set(session.sessionId, session);for (const person of participants) this.membership.set(person.participantId, session.sessionId);return session;
    }

    remove(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        session.dispose();
        for (const participantId of session.clientsData.keys()) this.membership.delete(participantId);
        this.sessions.delete(id);
    }
}
module.exports = { SessionRegistry };
