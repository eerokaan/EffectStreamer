const { ExperimentSession } = require("./ExperimentSession.js");
const { SessionStore } = require("./SessionStore.js");

class SessionRegistry {
    constructor({ config, io, root, enrollments }) {
        this.config = config; this.io = io; this.root = root; this.enrollments = enrollments;
        this.sessions = new Map(); this.membership = new Map();
        this.store = new SessionStore(root);
    }

    createPair(participants) {
        if (participants.length !== 2 || participants.some(participant => !participant)) throw new Error("A session requires exactly two participants");
        const ids = participants.map(participant => participant.participantId);
        if (new Set(ids).size !== 2 || ids.some(id => this.membership.has(id))) throw new Error("Participant already paired");
        if ([...this.sessions.values()].filter(session => session.phase !== "ended").length >= this.config.deployment.maxActivePairs) throw new Error("Pair capacity reached");
        const session = new ExperimentSession({ participants, config: this.config, io: this.io, root: this.root, store: this.store, enrollments: this.enrollments });
        session.transfers = this.transfers;
        this.sessions.set(session.sessionId, session);
        for (const participant of participants) {this.membership.set(participant.participantId, session.sessionId);participant.sessionId = session.sessionId;}
        this.enrollments.save();
        // Serialized persistence is also awaited by actions/loadAll before reporting successful state.
        session.persist().catch(error => {session.persistenceError = error;});
        return session;
    }

    getForParticipant(id) { return this.sessions.get(this.membership.get(id)); }

    remove(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        session.dispose();
        for (const participantId of session.clientsData.keys()) this.membership.delete(participantId);
        this.sessions.delete(id);
    }
}
module.exports = { SessionRegistry };
