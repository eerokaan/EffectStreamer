const { validateEnvelope, EVENTS } = require("@effectstreamer/common");
const { validatePretestAnswers } = require("./ParticipantResponses.js");

class AdmissionFlow {
    constructor({ config, enrollments, registry, prolific }) {
        this.config = config;this.enrollments = enrollments;this.registry = registry;this.prolific = prolific;this.connected = new Map();this.requests = new Map();
        this.timer = setInterval(() => {if (this.prolific.expireWaiting()) this.publish();this.match();}, Math.min(1000, config.sessions.pairingTimeoutMs));
        this.timer.unref();
    }
    snapshot(id) {
        const person = this.enrollments.get(id);
        return { revision: person.revision || 0, participantId: id, sessionId: null, role: null, phase: person.outcome ? "ended" : person.currentView === "viewWaiting" ? "waiting" : "admission",
            currentView: person.currentView, setupRequired: this.config.audioSetup.enabled, setupComplete: person.setupComplete, attemptId: null,
            viewData: { ...(person.currentView === "viewPretest" ? { pretestForm: this.config.pretestForm } : {}), completion: this.prolific.previewCompletion(id) }, outcome: person.outcome };
    }
    attach(socket, id) {
        const previous = this.connected.get(id);this.connected.set(id, socket);
        // Paired sockets are replaced by ClientRegistry only after it updates
        // the durable participant slot; disconnecting first fakes a dropout.
        if (previous && previous !== socket && !this.registry.getForParticipant(id)) previous.disconnect(true);
        if (!this.registry.getForParticipant(id)) socket.emit(EVENTS.snapshot, this.snapshot(id));
    }
    detach(socket, id) {if (this.connected.get(id) === socket) this.connected.delete(id);}
    async dispatch(id, envelope) {
        validateEnvelope(envelope);const person = this.enrollments.get(id);
        if (!person || envelope.participantId !== id || envelope.sessionId !== null || envelope.attemptId !== null || person.sessionId) throw new Error("Invalid admission scope");
        if (this.requests.has(envelope.requestId)) {
            if (this.requests.get(envelope.requestId) !== id) throw new Error("Request belongs to another participant");
            return this.snapshot(id);
        }
        if (person.outcome) throw new Error("Admission has ended");
        const payload = envelope.payload;
        if (envelope.type === "setupComplete") {
            if (payload.inputUsable !== true || payload.playbackConfirmed !== true) throw new Error("Device test and playback confirmation required");
            person.setupComplete = true;
        }
        else if (envelope.type === "setupInvalidated") {person.setupComplete = false;}
        else if (envelope.type === "pretest") {
            if (person.currentView !== "viewPretest") throw new Error("Invalid pretest view");
            person.formData = validatePretestAnswers(this.config.pretestForm, payload.formData);person.pretestComplete = true;
        }
        else if (["nextView", "ready"].includes(envelope.type)) {
            if (payload.currentView !== person.currentView) throw new Error("Stale admission view");
            if (!person.setupComplete) throw new Error("Audio setup required");
            if (person.currentView === "viewWelcome") person.currentView = "viewPretest";
            else if (["viewPretest", "viewWaiting"].includes(person.currentView)) {
                if (!person.pretestComplete) throw new Error("Required pretest answers missing");
                this.enrollments.ready(id);person.currentView = "viewWaiting";
            }
            else throw new Error("Action is not available in admission");
        }
        else if (envelope.type === "leave") {person.outcome = "partnerLeft";person.currentView = "viewEnding";}
        else throw new Error("Action is not available before pairing");
        person.admissionLastActiveAt = this.prolific.now();
        person.revision = (person.revision || 0) + 1;this.enrollments.save();
        this.requests.set(envelope.requestId, id);if (this.requests.size > 1024) this.requests.delete(this.requests.keys().next().value);
        this.publish();this.match();
        return this.registry.getForParticipant(id)?.snapshot(id) || this.snapshot(id);
    }
    publish() {for (const [id, socket] of this.connected) if (!this.registry.getForParticipant(id)) socket.emit(EVENTS.snapshot, this.snapshot(id));}
    match() {
        if (this.matching || this.closing || this.config.deployment.mode !== "remote") return;
        this.matching = true;
        try {
            this.prolific.expireWaiting();
            while ([...this.registry.sessions.values()].filter(session => session.phase !== "ended").length < this.config.deployment.maxActivePairs) {
                const people = this.enrollments.nextPair(person => this.connected.has(person.participantId));if (people.length !== 2) break;
                const session = this.registry.createPair(people);
                for (const person of people) session.clientRegistry.attach(this.connected.get(person.participantId), person.participantId);
            }
        }
        finally {this.matching = false;}
    }
    close() {this.closing = true;clearInterval(this.timer);}
}
module.exports = { AdmissionFlow };
