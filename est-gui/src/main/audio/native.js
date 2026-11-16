import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import protocol from "@effectstreamer/common";
import { normalizeAudioConfig } from "../lib/clientConfig.js";
import managedCore from "@effectstreamer/common/core-process";
import { writeFileDirect } from "@effectstreamer/common/direct-write";
import { uploadRecording } from "../../shared/recording-transfer.js";

const execute = promisify(execFile);
function backend(platform) {
    if (platform === "linux") return "alsa";
    if (platform === "win32") return "wasapi2";
    throw new Error("Native audio requires Linux or Windows");
}
export function coreArguments({ platform, component, devices, condition = {}, peer, ports = {}, directory }) {
    if (!["sender", "receiver"].includes(component)) throw new Error("Invalid native component");
    const args = ["--mode", component, "--device-type", backend(platform), "--device-id", component === "sender" ? devices.source : devices.sink,
        "--control", "ndjson", "--recording", "wav", "--recording-dir", directory,
        "--echo-port", String(ports.echo ?? 9005), "--record-port", String(ports.record ?? 9006)];
    if (component === "sender") {
        args.push("--peerip", peer.ipAddress, "--peer-port", String(peer.port ?? 9004));
        const options = { nativeDelay: "native-delay", echoDelay: "echo-delay", packetlossType: "packetloss-type", packetlossRatio: "packetloss-ratio", packetlossSeed: "packetloss-seed", packetlossBurstModel: "packetloss-burst-model", packetlossBurstRatio: "packetloss-burst-ratio" };
        for (const [key, option] of Object.entries(options)) if (condition[key] != null) args.push("--" + option, String(condition[key]));
    }
    else {
        args.push("--listen-port", String(ports.listen ?? 9004));
        for (const [key, option] of [["nativeGain", "native-gain"], ["echoGain", "echo-gain"]]) if (condition[key] != null) args.push("--" + option, String(condition[key]));
    }
    return args;
}

export class NativeAudioRuntime {
    constructor({ config, executable, env = process.env, platform = process.platform, recordingRoot, testAsset, runUtility, startCore = managedCore.startCore, onFailure = () => {} }) {
        this.config = config; this.audio = normalizeAudioConfig(config); this.executable = executable;
        this.env = env; this.platform = platform; this.root = path.resolve(this.audio.recordingDir || recordingRoot);
        this.testAsset = testAsset; this.startCore = startCore; this.onFailure = onFailure;
        this.runUtility = runUtility || (async args => {
            try { const { stdout } = await execute(executable, args, { env, timeout: 35000, maxBuffer: 1048576 }); return JSON.parse(stdout); }
            catch (error) { throw new Error(error.stdout ? JSON.parse(error.stdout).error || error.message : error.message); }
        });
        this.pending = new Map(); this.receipts = new Map(); this.current = null; this.loaded = null;
    }
    directory(scope) {
        protocol.validateScope(scope);protocol.identifier(scope.attemptId, "attemptId");
        return path.join(this.root, scope.sessionId, scope.attemptId, scope.participantId);
    }
    async loadPending() {
        this.loaded ||= (async () => {
            try {
                const values = JSON.parse(await fs.promises.readFile(path.join(this.root, "pending-recordings.json"), "utf8"));
                for (const manifest of values) {protocol.validateManifest(manifest);this.pending.set(manifest.recordingId, { manifest, file: path.join(this.directory(manifest), manifest.filename) });}
            }
            catch (error) { if (error.code !== "ENOENT") throw error; }
        })();
        return this.loaded;
    }
    async savePending() {
        await fs.promises.mkdir(this.root, { recursive: true });
        const destination = path.join(this.root, "pending-recordings.json");
        await writeFileDirect(destination, JSON.stringify([...this.pending.values()].map(value => value.manifest)));
    }
    async listDevices() {
        const devices = await this.runUtility(["--list-devices", "--device-type", backend(this.platform)]);
        return { ...devices, selection: { sourceId: this.audio.devices.source, sinkId: this.audio.devices.sink } };
    }
    async testDevices({ sourceId, sinkId }) {
        if (this.current) throw new Error("Cannot change devices during an active attempt");
        const input = await this.runUtility(["--mode", "test-input", "--device-type", backend(this.platform), "--device-id", sourceId, "--test-duration-ms", "1000"]);
        if (!input.ok || !input.inputUsable) throw new Error(input.error || "Input check failed");
        const output = await this.runUtility(["--mode", "test-output", "--device-type", backend(this.platform), "--device-id", sinkId, "--test-file", this.testAsset]);
        if (!output.ok) throw new Error(output.error || "Playback check failed");
        this.tested = { sourceId, sinkId };
        return { inputUsable: true, playbackComplete: true, peak: input.peak };
    }
    async saveDevices(selection) {
        if (this.current) throw new Error("Cannot change devices during an active attempt");
        if (this.tested?.sourceId !== selection.sourceId || this.tested?.sinkId !== selection.sinkId) throw new Error("Selected devices must be tested first");
        this.audio.devices = { source: selection.sourceId, sink: selection.sinkId };
        return this.audio.devices;
    }
    async prepare({ scope, component, condition, peer, ports }) {
        const directory = this.directory(scope);
        if (this.current && this.current.scope.attemptId !== scope.attemptId) throw new Error("Another attempt is active");
        this.current ||= { scope: { ...scope }, handles: {}, finalized: false };
        if (this.current.handles[component]) return;
        const args = coreArguments({ platform: this.platform, component, devices: this.audio.devices, condition, peer, ports, directory });
        const core = await this.startCore({ executable: this.executable, args, env: this.env, timeoutMs: 10000 });
        this.current.handles[component] = core;
        core.on("exit", result => this.onFailure(new Error("Native " + component + " exited unexpectedly: " + result.code)));
        core.on("media-failed", error => this.onFailure(error instanceof Error ? error : new Error("Native media failed")));
        core.on("recording-finalized", () => { if (this.current?.scope.attemptId === scope.attemptId) this.current.finalized = true; });
    }
    requireAttempt(scope) {
        if (!this.current || this.current.scope.attemptId !== scope.attemptId || this.current.scope.sessionId !== scope.sessionId || this.current.scope.participantId !== scope.participantId) throw new Error("Native attempt scope mismatch");
        return this.current;
    }
    async start(scope) {
        const current = this.requireAttempt(scope);
        for (const role of ["receiver", "sender"]) {
            if (!current.handles[role]) throw new Error("Native components are not prepared");
            await current.handles[role].request("audio.start", {});
        }
    }
    async stop(scope) {
        const current = this.requireAttempt(scope);
        current.stopPromise ||= (async () => {
            let failure;
            for (const role of ["sender", "receiver"]) {
                try { await current.handles[role]?.stop({ timeoutMs: 7000 }); }
                catch (error) { failure ||= error; }
            }
            if (!current.finalized && current.handles.receiver) failure ||= new Error("Receiver did not finalize WAV recordings");
            if (this.current === current) this.current = null;
            if (failure) throw failure;
        })();
        return current.stopPromise;
    }
    async recordings(scope, { status = "complete" } = {}) {
        await this.loadPending();
        const directory = this.directory(scope), manifests = [];
        for (const track of protocol.RECORDING_TRACKS) {
            const existing = [...this.pending.values()].find(({ manifest }) => manifest.sessionId === scope.sessionId && manifest.attemptId === scope.attemptId && manifest.participantId === scope.participantId && manifest.track === track);
            if (existing) {manifests.push(existing.manifest);continue;}
            const file = path.join(directory, track + ".wav");
            const bytes = (await fs.promises.stat(file)).size;
            const hash = createHash("sha256");for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
            const manifest = { recordingId: randomUUID(), ...scope, track, filename: track + ".wav", source: "local-file", contentType: "audio/wav", byteLength: bytes, sha256: hash.digest("hex"), status };
            protocol.validateManifest(manifest);this.pending.set(manifest.recordingId, { manifest, file });manifests.push(manifest);
        }
        await this.savePending();return manifests;
    }
    async release(receipt) {
        await this.loadPending();
        const entry = this.pending.get(receipt.recordingId);
        if (!entry || receipt.sha256 !== entry.manifest.sha256 || receipt.stored !== true) throw new Error("Invalid native recording receipt");
        await fs.promises.rm(entry.file, { force: true });this.pending.delete(receipt.recordingId);this.receipts.set(receipt.recordingId, receipt);await this.savePending();
    }
    collect(command, options) {
        const pending = (this.collecting || Promise.resolve()).catch(() => {}).then(() => this.collectSerial(command, options));this.collecting = pending;return pending;
    }
    async collectSerial(command, { url, credentials, config }) {
        await this.loadPending();
        for (const id of command.recordingIds) {
            if (this.receipts.has(id)) continue;
            const entry = this.pending.get(id);
            if (!entry || entry.manifest.sessionId !== command.sessionId || entry.manifest.attemptId !== command.attemptId) throw new Error("Unknown requested native recording");
            await uploadRecording({ manifest: entry.manifest, baseUrl: url, headers: { authorization: "Bearer " + credentials.reconnectToken },
                chunkBytes: config.recordings.chunkBytes, timeoutMs: config.recordings.uploadTimeoutMs,
                readChunk: async (_id, offset, length) => {
                    const file = await fs.promises.open(entry.file, "r");
                    try { const bytes = Buffer.alloc(length);const result = await file.read(bytes, 0, length, offset);if (result.bytesRead !== length) throw new Error("Native recording is truncated");return bytes; }
                    finally { await file.close(); }
                }, onReceipt: receipt => this.release(receipt)
            });
        }
    }
    async dispose() { if (this.current) await this.stop(this.current.scope); }
}
