const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { startCore } = require("@effectstreamer/common/core-process");
const { identifier } = require("@effectstreamer/common");
const { coreEnvironment } = require("@effectstreamer/common/core-environment");

function iceArguments(servers) {
    const args = [];
    for (const server of servers) for (const url of Array.isArray(server.urls) ? server.urls : [server.urls]) {
        const match = /^(stun|stuns|turn|turns):(?:\/\/)?([^?]+)(?:\?transport=(udp|tcp))?$/.exec(url);
        if (!match) throw new Error("Unsupported ICE server URL");
        const [, scheme, address, transport] = match;
        if (scheme.startsWith("stun")) args.push("--stun-server", scheme + "://" + address);
        else {
            if (!server.username || !server.credential) throw new Error("TURN credentials required");
            args.push("--turn-server", scheme + "://" + encodeURIComponent(server.username) + ":" + encodeURIComponent(server.credential) + "@" + address + (transport ? "?transport=" + transport : ""));
        }
    }
    return args;
}
class MediaWorker extends EventEmitter {
    constructor({ config, env = process.env }) {
        super(); this.config = config; this.env = coreEnvironment({executable: config.coreExecutable, env}); this.children = new Map(); this.state = "idle"; this.stopping = false;
    }
    async prepare({ sessionId, attemptId, participants, condition, endpoints, ice = this.config.iceServers }) {
        if (this.children.size || this.preparing) throw new Error("Worker already owns an attempt");
        identifier(sessionId, "sessionId"); identifier(attemptId, "attemptId");
        if (!Array.isArray(participants) || participants.length !== 2 || new Set(participants).size !== 2) throw new Error("Worker requires two participants");
        participants.forEach(id => identifier(id, "participantId"));
        if (!Array.isArray(endpoints) || endpoints.length !== 6 || new Set(endpoints).size !== 6 || endpoints.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error("Invalid worker endpoints");
        this.sessionId = sessionId; this.attemptId = attemptId; this.participants = [...participants]; this.generation = randomUUID();
        this.state = "preparing"; this.stopping = false; this.stopPromise = null; this.failure = null; this.primed = false; this.priming = null; this.preparing = true;
        let finishPreparation;
        this.preparationDone = new Promise(resolve => {finishPreparation = resolve;});
        try {
            // Receivers bind first, so a port conflict never releases a sender.
            for (const connectionId of ["downlink", "uplink"]) for (let index = 0; index < 2; index++) {
                const participantId = participants[index], sender = connectionId === "uplink";
                const args = ["--mode", sender ? "sender" : "receiver", "--device-type", "webrtc", "--control", "ndjson", "--recording", "none",
                    "--echo-port", String(endpoints[index * 3 + 1]), "--record-port", String(endpoints[index * 3 + 2]),
                    "--ice-min-port", String(this.config.icePortRange[0]), "--ice-max-port", String(this.config.icePortRange[1]),
                    "--webrtc-jitter-ms", String(this.config.jitterMs), "--opus-bitrate", String(this.config.opusBitrate), ...iceArguments(ice || [])];
                if (sender) {
                    args.push("--peerip", "127.0.0.1", "--peer-port", String(endpoints[(1 - index) * 3]), "--rtp-frames", String(this.config.rtpFrames));
                    for (const [key, flag] of Object.entries({ nativeDelay: "native-delay", echoDelay: "echo-delay", packetlossType: "packetloss-type", packetlossRatio: "packetloss-ratio", packetlossSeed: "packetloss-seed", packetlossBurstModel: "packetloss-burst-model", packetlossBurstRatio: "packetloss-burst-ratio" })) if (condition[key] != null) args.push("--" + flag, String(condition[key]));
                }
                else {
                    args.push("--bind-address", "127.0.0.1", "--listen-port", String(endpoints[index * 3]));
                    for (const [key, flag] of [["nativeGain", "native-gain"], ["echoGain", "echo-gain"]]) if (condition[key] != null) args.push("--" + flag, String(condition[key]));
                }
                const core = await startCore({ executable: this.config.coreExecutable, args, env: this.env, timeoutMs: this.config.startupTimeoutMs });
                if (this.stopping) {await core.stop({ timeoutMs: this.config.stopTimeoutMs });throw new Error("Worker preparation cancelled");}
                const key = participantId + ":" + connectionId;
                const record = { core, participantId, connectionId, args, connected: false, mediaReady: false };
                this.children.set(key, record);
                core.on("ice-candidate", candidate => this.emit("signal", { sessionId, attemptId, participantId, connectionId, generation: this.generation, type: "ice", ...candidate }));
                core.on("connection-state", ({ state }) => {
                    record.connected = state === "connected";
                    if (state === "failed" || state === "disconnected") this.failed(new Error("WebRTC connection " + state));
                    this.emit("readiness");
                    if (this.children.size === 4 && [...this.children.values()].every(child => child.connected) && !this.priming) {
                        this.priming = this.ready();void this.priming.catch(error => this.failed(error));
                    }
                });
                core.on("media-ready", () => { record.mediaReady = true; this.emit("readiness"); });
                core.on("media-failed", error => this.failed(error instanceof Error ? error : new Error("Core media failed")));
                core.on("exit", ({ code, signal }) => this.failed(new Error("Core exited unexpectedly: " + (code ?? signal))));
            }
            this.state = "prepared";
            return { generation: this.generation };
        }
        catch (error) { this.stopping = true;await this.stopChildren().catch(() => {});throw error; }
        finally { this.preparing = false;finishPreparation(); }
    }
    async signal(participantId, message) {
        if (!this.participants?.includes(participantId)) throw new Error("Unknown worker participant/owner");
        if (message.sessionId !== this.sessionId || message.attemptId !== this.attemptId) throw new Error("Invalid signaling scope");
        if (message.generation !== this.generation || this.stopping) throw new Error("Stale media generation");
        const child = this.children.get(participantId + ":" + message.connectionId);
        if (!child) throw new Error("Unknown media connection");
        if (message.type === "offer") {
            if (typeof message.sdp !== "string" || message.sdp.length > 262144) throw new Error("Invalid SDP offer");
            return child.core.request("webrtc.offer", { type: "offer", sdp: message.sdp });
        }
        if (message.type === "ice") {
            if (message.candidate !== null && (typeof message.candidate !== "string" || message.candidate.length > 16384)) throw new Error("Invalid ICE candidate");
            return child.core.request("webrtc.ice", { candidate: message.candidate, sdpMLineIndex: message.sdpMLineIndex });
        }
        throw new Error("Unknown signaling message");
    }
    async ready({ timeoutMs = this.config.startupTimeoutMs } = {}) {
        if (this.failure) throw this.failure;
        const wait = predicate => new Promise((resolve, reject) => {
            const finish = error => {clearTimeout(timer);this.off("readiness", check);error ? reject(error) : resolve();};
            const check = () => {if (this.failure || this.stopping) finish(this.failure || new Error("Worker stopped"));else if (predicate()) finish();};
            const timer = setTimeout(() => finish(new Error("Media readiness timed out")), timeoutMs);
            this.on("readiness", check);check();
        });
        await wait(() => this.children.size === 4 && [...this.children.values()].every(child => child.connected));
        // The only pre-start media is core-generated silence, not microphone content.
        if (!this.primed) {
            this.primed = true;
            await Promise.all([...this.children.values()].filter(child => child.connectionId === "uplink").map(child => child.core.request("audio.prime", {})));
        }
        await wait(() => [...this.children.values()].every(child => child.mediaReady));
    }
    async start() {
        await this.ready();
        for (const connectionId of ["downlink", "uplink"]) await Promise.all([...this.children.values()].filter(child => child.connectionId === connectionId).map(child => child.core.request("audio.start", {})));
        this.state = "running";
    }
    failed(error) {
        if (this.stopping || this.failure) return;
        this.failure = error; this.emit("readiness"); this.emit("failure", error);
        void this.stop().catch(() => {});
    }
    stop() {
        this.stopPromise ||= (async () => {
            this.stopping = true; this.emit("readiness");
            await this.preparationDone;
            await this.stopChildren();
        })();
        return this.stopPromise;
    }
    async stopChildren() {
        let failure;
        for (const connectionId of ["uplink", "downlink"]) {
            const results = await Promise.allSettled([...this.children.values()].filter(child => child.connectionId === connectionId).map(async child => {
                try {await child.core.stop({ timeoutMs: this.config.stopTimeoutMs });}
                catch (error) {throw new Error(child.participantId + "/" + connectionId + ": " + error.message);}
            }));
            failure ||= results.find(result => result.status === "rejected")?.reason;
        }
        this.children.clear(); this.state = "stopped";
        if (failure) throw failure;
    }
    async dispose() { await this.stop().catch(() => {}); }
    health() { return { state: this.state, mediaReady: [...this.children.values()].filter(child => child.mediaReady).length, children: [...this.children.values()].map(({ core, participantId, connectionId, args }) => ({ pid: core.child.pid, participantId, connectionId, args })) }; }
}
function runMediaWorker() {
    if (!process.send) throw new Error("Media worker requires parent IPC");
    let worker, ending = false;
    const close = async () => {if (ending) return;ending = true;await worker?.dispose();process.exit(0);};
    process.on("disconnect", close); process.once("SIGTERM", close); process.once("SIGINT", close);
    process.on("message", async message => {
        const reply = value => {if (process.connected) process.send({ id: message.id, ...value });};
        try {
            if (message.method === "prepare") {
                if (!worker) {
                    worker = new MediaWorker({ config: message.config });
                    worker.on("signal", payload => {if (process.connected) process.send({ event: "signal", payload });});
                    worker.on("failure", error => {if (process.connected) process.send({ event: "failure", error: error.message });});
                }
                reply({ ok: true, result: await worker.prepare(message.payload) });
            }
            else if (["ready", "start", "stop", "health"].includes(message.method)) reply({ ok: true, result: await worker[message.method](message.payload) });
            else if (message.method === "signal") reply({ ok: true, result: await worker.signal(message.participantId, message.payload) });
            else if (message.method === "dispose") {await worker?.dispose();reply({ ok: true });await close();}
            else throw new Error("Unknown worker operation");
        }
        catch (error) {reply({ ok: false, error: error.message });}
    });
    process.send({ event: "worker-ready" });
}
module.exports = { MediaWorker, runMediaWorker, iceArguments };
