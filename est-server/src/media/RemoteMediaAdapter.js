const { spawn } = require("node:child_process");
const { randomUUID, createHmac } = require("node:crypto");
const { isSea } = require("node:sea");
const path = require("node:path");
const { EVENTS } = require("@effectstreamer/common");

class RemoteMediaAdapter {
    constructor({ config, allocator, clientRegistry, onFailure = () => {} }) {
        this.config = config; this.allocator = allocator; this.clientRegistry = clientRegistry; this.onFailure = onFailure;
        this.pending = new Map(); this.disposing = false;
    }
    async spawn() {
        if (this.child) throw new Error("Media worker is already active");
        this.disposing = false;
        this.closePromise = null;
        const child = spawn(process.execPath, isSea() ? [] : [path.join(__dirname, "../index.js")], { env: { ...process.env, EST_SERVER_TYPE: "media-worker" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
        this.child = child; let stderr = "";
        this.exited = new Promise(resolve => child.once("close", resolve));
        child.stderr.on("data", bytes => {stderr = (stderr + bytes).slice(-32768);});
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {reject(new Error("Worker startup timed out"));void this.dispose();}, this.config.startupTimeoutMs);
            child.on("message", message => {
                if (message.event === "worker-ready") {clearTimeout(timer);resolve();}
                else if (message.event === "signal") {
                    const client = this.session?.clientsData.get(message.payload.participantId);
                    if (client && message.payload.generation === this.generation) this.clientRegistry.emitToSocket(client.socketId, EVENTS.signal, message.payload);
                }
                else if (message.event === "failure" && !this.disposing) this.onFailure(new Error(message.error));
                else if (this.pending.has(message.id)) {
                    const pending = this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(pending.timer);
                    message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error));
                }
            });
            const failed = error => {
                clearTimeout(timer);reject(error);
                for (const request of this.pending.values()) {clearTimeout(request.timer);request.reject(error);}this.pending.clear();
                if (!this.disposing) this.onFailure(error);
            };
            child.once("error", failed);
            child.once("close", code => failed(new Error("Media worker exited (" + code + "): " + stderr)));
        });
    }
    request(method, payload, participantId) {
        const child = this.child;
        if (!child?.connected) return Promise.reject(new Error("Media worker is disconnected"));
        return new Promise((resolve, reject) => {
            const id = randomUUID(), timeout = method === "stop" ? 2 * this.config.stopTimeoutMs + 1000 : 4 * this.config.startupTimeoutMs + 1000;
            const timer = setTimeout(() => {this.pending.delete(id);reject(new Error("Worker " + method + " timed out"));}, timeout);
            this.pending.set(id, { resolve, reject, timer });
            child.send({ id, method, payload, participantId, ...(method === "prepare" ? { config: this.config } : {}) }, error => {
                if (error && this.pending.delete(id)) {clearTimeout(timer);reject(error);}
            });
        });
    }
    iceServers() {
        const servers = structuredClone(this.config.iceServers);
        if (this.config.turnSecret && this.config.turnUrls.length) {
            const username = Math.floor(Date.now() / 1000 + 3600) + ":" + this.session.sessionId;
            servers.push({ urls: [...this.config.turnUrls], username, credential: createHmac("sha1", this.config.turnSecret).update(username).digest("base64") });
        }
        return servers;
    }
    async prepare({ session, attempt, condition }) {
        this.session = session; this.attempt = attempt;this.stopPromise = null;
        const ice = this.iceServers();
        // Retain conflicting leases until a replacement succeeds, so retry cannot
        // repeatedly choose the same externally occupied port.
        const rejected = [];
        try {
            for (let retry = 0; retry < 3; retry++) {
                const owner = session.sessionId + "-" + attempt.contextKey + "-" + retry;
                this.owner = owner;
                const endpoints = this.allocator.lease(owner, 6);
                try {
                    await this.spawn();
                    const result = await this.request("prepare", { sessionId: session.sessionId, attemptId: attempt.contextKey, participants: [...session.clientsData.keys()], endpoints, condition, ice });
                    this.generation = result.generation;
                    for (const client of session.clientsData.values()) this.emit(client, "prepareRemote", { iceServers: ice, connections: ["uplink", "downlink"] });
                    return;
                }
                catch (error) {
                    await this.closeWorker();
                    if (retry === 2 || !/bind|address already|resource.*busy/i.test(error.message)) {this.allocator.release(owner);throw error;}
                    rejected.push(owner);
                }
            }
        }
        finally {for (const owner of rejected) this.allocator.release(owner);}
    }
    emit(client, type, payload = {}) {
        this.clientRegistry.emitToSocket(client.socketId, EVENTS.mediaCommand, { type, attemptId: this.attempt.contextKey, generation: this.generation, ...payload });
    }
    async signal(participantId, message) {
        if (!this.session?.clientsData.has(participantId) || message.sessionId !== this.session.sessionId || message.attemptId !== this.attempt.contextKey) throw new Error("Invalid participant signaling scope");
        if (message.generation !== this.generation) throw new Error("Stale media generation");
        return this.request("signal", message, participantId);
    }
    async start() {
        await this.request("ready");
        for (const client of this.session.clientsData.values()) this.emit(client, "startAudio");
    }
    async release() { await this.request("start"); }
    stop({ reason }) {
        this.stopPromise ||= (async () => {
            for (const client of this.session.clientsData.values()) this.emit(client, "stopCapture");
            let failure;
            try {if (this.child?.connected) await this.request("stop");} catch (error) {failure = error;}
            await this.closeWorker();
            await new Promise(resolve => setTimeout(resolve, this.config.playbackDrainMs));
            for (const client of this.session.clientsData.values()) this.emit(client, "stopCore", { reason: failure ? "interrupted" : reason });
            this.allocator.release(this.owner);
            if (failure) throw failure;
        })();
        return this.stopPromise;
    }
    closeWorker() {
        this.closePromise ||= this.closeWorkerOnce();
        return this.closePromise;
    }
    async closeWorkerOnce() {
        const child = this.child;if (!child) return;
        this.disposing = true;
        if (child.connected) await this.request("dispose").catch(() => {});
        let timer;
        await Promise.race([this.exited, new Promise(resolve => {timer = setTimeout(() => {child.kill("SIGKILL");resolve();}, 2000);})]);clearTimeout(timer);
        await this.exited; this.child = null;
    }
    async dispose() {await this.closeWorker();if (this.owner) this.allocator.release(this.owner);}
}
module.exports = { RemoteMediaAdapter };
