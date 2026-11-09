import { isLittleEndian, stopCore } from "./coreProcess";
import { MessageChannelMain } from "electron";

const audioBlockBytes = 128 * Float32Array.BYTES_PER_ELEMENT;
const captureCreditWindow = 4;
const playbackCreditWindow = 8;
const portReadyTimeoutMs = 10000;
const diagnosticSampleLimit = 4096;

function createDirectionState() {
    return {
        port: null,
        ready: false,
        readyPromise: null,
        resolveReady: null,
        rejectReady: null,
        credits: 0,
        expectedSequence: 0,
        finalStatsPromise: null,
        resolveFinalStats: null,
        stats: {},
        buffers: [],
        pendingRecycle: [],
        occupancySamples: [],
        correctionSamples: [],
        occupancySampleCount: 0,
        correctionSampleCount: 0
    };
}

function createSession(contextKey, devices) {
    return {
        contextKey,
        active: true,
        stopping: false,
        senderStarted: false,
        receiverStarted: false,
        startupErrors: {
            sender: null,
            receiver: null
        },
        startedAt: new Date().toISOString(),
        endedAt: null,
        devices,
        audioContext: null,
        capture: {
            ...createDirectionState(),
            enabled: false,
            backpressured: false,
            blocksReceived: 0,
            blocksWritten: 0,
            backpressureDroppedBlocks: 0,
            invalidBlocks: 0,
            sequenceGaps: 0
        },
        playback: {
            ...createDirectionState(),
            tail: Buffer.alloc(0),
            nextSequence: 0,
            blocksFromCore: 0,
            blocksSent: 0,
            creditDroppedBlocks: 0,
            trailingBytes: 0
        },
        sender: null,
        receiver: null
    };
}

function appendBounded(state, key, values, sampleCount = values?.length || 0) {
    if (!values || sampleCount <= 0) return;
    const target = state[key];
    const countKey = key === "occupancySamples" ? "occupancySampleCount" : "correctionSampleCount";
    for (let index = 0; index < Math.min(values.length, sampleCount); index++) {
        const value = values[index];
        if (!Number.isFinite(value)) continue;
        state[countKey]++;
        if (target.length < diagnosticSampleLimit) {
            target.push(value);
            continue;
        }
        const replacementIndex = Math.floor(Math.random() * state[countKey]);
        if (replacementIndex < diagnosticSampleLimit) target[replacementIndex] = value;
    }
}

class AudioTransport {
    constructor({ window, requestRendererControl, onFatal }) {
        this.window = window;
        this.requestRendererControl = requestRendererControl;
        this.onFatal = onFatal;
        this.session = null;
        this.lastWarningAt = 0;
    }

    isActive() {
        return Boolean(this.session?.active);
    }

    async startSender(contextKey, devices, deadline = null) {
        if (!isLittleEndian()) throw new Error("The stdio audio transport requires a little-endian architecture for F32LE");
        if (this.session?.active) throw new Error("An audio condition is already active");

        const session = createSession(contextKey, devices);
        this.session = session;

        try {
            this.createPort(session, "capture", deadline);
            const [contextInfo] = await Promise.all([
                this.requestRendererControl(
                    "start-sender",
                    {
                        contextKey,
                        sourceId: devices.source.id,
                        sinkId: devices.sink.id
                    },
                    deadline
                ),
                session.capture.readyPromise
            ]);
            if (this.session !== session || !session.active) throw new Error("The audio session was replaced during sender startup");
            session.audioContext = contextInfo;
            return session;
        }
        catch (error) {
            error.audioSetup = true;
            await this.abortStartup(session);
            throw error;
        }
    }

    async startReceiver(contextKey, deadline = null) {
        const session = this.requireSession(contextKey);
        try {
            this.createPort(session, "playback", deadline);
            await Promise.all([this.requestRendererControl("start-receiver", { contextKey }, deadline), session.playback.readyPromise]);
            if (this.session !== session || !session.active) throw new Error("The audio session was replaced during receiver startup");
        }
        catch (error) {
            error.audioSetup = true;
            throw error;
        }
    }

    setCore(component, record) {
        const session = this.requireSession();
        session[component] = record;
        if (component === "receiver") this.attachReceiverStdout(session, record);
    }

    markComponentStarted(component) {
        const session = this.requireSession();
        if (session.startupErrors[component]) throw session.startupErrors[component];
        session[component + "Started"] = true;
    }

    enableCapture() {
        const session = this.requireSession();
        session.capture.enabled = true;
        for (let index = 0; index < captureCreditWindow; index++) {
            this.recycleCaptureBuffer(session, new Float32Array(128));
        }
    }

    handleCoreFailure(component, record, error) {
        const session = this.session;
        if (!session || !session.active || session.stopping || session[component] !== record) return;
        if (session[component + "Started"]) this.onFatal(error);
        else session.startupErrors[component] = error;
    }

    handleRendererFailure(data) {
        const session = this.session;
        if (!session || !session.active || session.stopping || data?.contextKey !== session.contextKey) return;
        const component = data.component === "capture" ? "sender" : data.component === "playback" ? "receiver" : null;
        if (!component) return;
        const error = new Error(data.message || "AudioWorklet failure");
        if (session[component + "Started"]) this.onFatal(error);
        else session.startupErrors[component] = error;
    }

    createPort(session, direction, deadline = null) {
        const channel = new MessageChannelMain();
        const state = session[direction];
        const component = direction === "capture" ? "sender" : "receiver";
        state.port = channel.port2;
        state.readyPromise = new Promise((resolve, reject) => {
            state.resolveReady = resolve;
            state.rejectReady = reject;
        });

        const readyTimeoutMs = deadline == null ? portReadyTimeoutMs : Math.max(1, deadline - Date.now());
        const readyTimeout = setTimeout(() => {
            if (!state.ready) state.rejectReady(new Error("Timed out waiting for the " + direction + " AudioWorklet media port"));
        }, readyTimeoutMs);

        state.port.on("message", (event) => {
            if (this.session !== session || !session.active) return;
            this.handlePortMessage(session, direction, event.data);
            if (state.ready) clearTimeout(readyTimeout);
        });
        state.port.on("messageerror", () => {
            const error = new Error("The " + direction + " media port received an invalid message");
            if (this.session !== session || !session.active || session.stopping) return;
            if (session[component + "Started"]) this.onFatal(error);
            else session.startupErrors[component] = error;
        });
        state.port.on("close", () => {
            clearTimeout(readyTimeout);
            const error = new Error("The " + direction + " media port closed unexpectedly");
            if (!state.ready) state.rejectReady(error);
            if (this.session === session && session.active && !session.stopping) {
                if (session[component + "Started"]) this.onFatal(error);
                else session.startupErrors[component] = error;
            }
        });
        state.port.start();
        this.window.webContents.postMessage("ipc:audioMediaPort", { contextKey: session.contextKey, direction }, [channel.port1]);
    }

    handlePortMessage(session, direction, data) {
        if (!data || typeof data !== "object") return;
        const state = session[direction];

        if (data.type === "ready") {
            if (!state.ready) {
                state.ready = true;
                state.resolveReady();
            }
            return;
        }
        if (data.type === "hard-resync" && direction === "playback") {
            console.warn("[audio-transport] playback hard resync for " + session.contextKey + ": " + JSON.stringify({ reason: data.reason, discardedFrames: data.discardedFrames, occupancyFrames: data.occupancyFrames, hardResyncs: data.hardResyncs }));
            return;
        }
        if (data.type === "stats") {
            state.stats = { ...state.stats, ...(data.stats || {}) };
            appendBounded(state, "occupancySamples", data.occupancySamples, data.sampleCount);
            appendBounded(state, "correctionSamples", data.correctionSamples, data.sampleCount);
            this.maybeWarn(session, direction);
            if (data.final && state.resolveFinalStats) {
                state.resolveFinalStats();
                state.resolveFinalStats = null;
            }
            return;
        }
        if (direction === "capture" && data.type === "audio") {
            this.handleCaptureBlock(session, data);
            return;
        }
        if (direction === "playback" && data.type === "recycle" && data.samples instanceof Float32Array && data.samples.length === 128 && state.buffers.length < playbackCreditWindow) {
            state.buffers.push(data.samples);
            state.credits = state.buffers.length;
        }
    }

    handleCaptureBlock(session, data) {
        const state = session.capture;
        const record = session.sender;
        state.credits = Math.max(0, state.credits - 1);

        if (!Number.isInteger(data.sequence) || data.sequence < 0) {
            state.invalidBlocks++;
            return;
        }
        if (data.sequence !== state.expectedSequence) {
            state.sequenceGaps += Math.max(1, data.sequence - state.expectedSequence);
        }
        state.expectedSequence = data.sequence + 1;

        const samples = data.samples;
        if (!(samples instanceof Float32Array) || samples.length !== 128 || samples.byteLength !== audioBlockBytes) {
            state.invalidBlocks++;
            return;
        }
        state.blocksReceived++;

        if (!state.enabled || !record || this.session !== session || session.sender !== record) {
            state.backpressureDroppedBlocks++;
            return;
        }
        if (record.child.stdin.destroyed || !record.child.stdin.writable) {
            state.backpressureDroppedBlocks++;
            state.pendingRecycle.push(samples);
            record.handleStreamFailure("stdin", new Error("stream is destroyed or no longer writable"));
            return;
        }
        if (state.backpressured) {
            state.backpressureDroppedBlocks++;
            state.pendingRecycle.push(samples);
            return;
        }

        let accepted;
        try {
            const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
            accepted = record.child.stdin.write(bytes, (error) => {
                if (error) {
                    record.handleStreamFailure("stdin write", error);
                    return;
                }
                if (this.session === session && session.active && !session.stopping && session.sender === record) this.recycleCaptureBuffer(session, samples);
            });
            state.blocksWritten++;
        }
        catch (error) {
            state.backpressureDroppedBlocks++;
            state.pendingRecycle.push(samples);
            record.handleStreamFailure("stdin write", error);
            return;
        }

        if (!accepted) {
            state.backpressured = true;
            record.child.stdin.once("drain", () => {
                if (this.session !== session || !session.active || session.stopping || session.sender !== record) return;
                state.backpressured = false;
                this.flushCaptureBuffers(session);
            });
        }
    }

    recycleCaptureBuffer(session, samples) {
        const state = session.capture;
        if (!state.port || !state.enabled || session.stopping) return;
        if (state.backpressured) {
            if (state.pendingRecycle.length < captureCreditWindow) state.pendingRecycle.push(samples);
            return;
        }
        try {
            state.credits++;
            // MessagePortMain only transfers ports. Typed arrays are cloned on this
            // leg and bounded by the recycled-buffer credit window.
            state.port.postMessage({ type: "recycle", samples });
        }
        catch (error) {
            state.credits = Math.max(0, state.credits - 1);
            if (session.senderStarted) this.onFatal(error);
            else session.startupErrors.sender = error;
        }
    }

    flushCaptureBuffers(session) {
        const state = session.capture;
        while (!state.backpressured && state.pendingRecycle.length > 0 && !session.stopping) {
            this.recycleCaptureBuffer(session, state.pendingRecycle.pop());
        }
    }

    attachReceiverStdout(session, record) {
        record.child.stdout.on("data", (chunk) => {
            if (this.session !== session || !session.active || session.receiver !== record) return;
            const state = session.playback;
            const bytes = state.tail.length > 0 ? Buffer.concat([state.tail, chunk]) : chunk;
            let offset = 0;

            while (offset + audioBlockBytes <= bytes.length) {
                const sequence = state.nextSequence++;
                state.blocksFromCore++;
                if (state.buffers.length > 0 && state.port && state.ready) {
                    const samples = state.buffers.pop();
                    Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).set(bytes.subarray(offset, offset + audioBlockBytes));
                    state.credits = state.buffers.length;
                    try {
                        state.port.postMessage({ type: "audio", sequence, samples });
                        state.blocksSent++;
                    }
                    catch (error) {
                        state.creditDroppedBlocks++;
                        if (session.receiverStarted) this.onFatal(error);
                        else session.startupErrors.receiver = error;
                    }
                }
                else {
                    state.creditDroppedBlocks++;
                }
                offset += audioBlockBytes;
            }

            state.tail = offset < bytes.length ? Buffer.from(bytes.subarray(offset)) : Buffer.alloc(0);
        });
        record.child.stdout.once("end", () => {
            if (this.session === session && session.receiver === record) session.playback.trailingBytes = session.playback.tail.length;
        });
    }

    requestFinalStats(state) {
        if (!state.port || !state.ready) return Promise.resolve();
        if (state.finalStatsPromise) return state.finalStatsPromise;
        state.finalStatsPromise = new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            state.resolveFinalStats = finish;
            setTimeout(finish, 500);
            state.port.postMessage({ type: "final-stats" });
        });
        return state.finalStatsPromise;
    }

    async stop() {
        const session = this.session;
        if (!session) return;
        if (session.stopPromise) return session.stopPromise;
        if (!session.active) return;

        session.stopPromise = this.stopSession(session);
        return session.stopPromise;
    }

    async stopSession(session) {
        let failure = null;
        const attempt = async (operation) => {
            try {
                await operation();
            }
            catch (error) {
                failure ||= error;
            }
        };

        session.stopping = true;
        session.capture.enabled = false;
        try {
            await attempt(async () => session.capture.port?.postMessage({ type: "freeze" }));
            const captureResults = await Promise.allSettled([this.requestFinalStats(session.capture), this.requestRendererControl("stop-capture", { contextKey: session.contextKey })]);
            for (const result of captureResults) {
                if (result.status === "rejected") failure ||= result.reason;
            }
            await attempt(() => stopCore(session.sender));
            await attempt(() => stopCore(session.receiver));
            await attempt(() => this.requestFinalStats(session.playback));
            await attempt(() => this.requestRendererControl("stop-condition", { contextKey: session.contextKey }));
            session.endedAt = new Date().toISOString();
        }
        finally {
            session.endedAt ||= new Date().toISOString();
            session.active = false;
            try {
                session.capture.port?.close();
            }
            catch {
                // Port already closed by concurrent cleanup.
            }
            try {
                session.playback.port?.close();
            }
            catch {
                // Port already closed by concurrent cleanup.
            }
            session.capture.pendingRecycle.length = 0;
            session.playback.buffers.length = 0;
            if (this.session === session) this.session = null;
        }
        if (failure) throw failure;
    }

    async abortStartup(session) {
        if (this.session !== session) return;
        session.stopping = true;
        try {
            this.requestRendererControl("stop-condition", { contextKey: session.contextKey }, Date.now() + 1000).catch(() => {
                // Renderer startup observes its provisional cancellation when the control arrives.
            });
        }
        finally {
            session.active = false;
            try {
                session.capture.port?.close();
            }
            catch {
                // Port was not transferred or is already closed.
            }
            try {
                session.playback.port?.close();
            }
            catch {
                // Port was not transferred or is already closed.
            }
            if (this.session === session) this.session = null;
        }
    }

    requireSession(contextKey = null) {
        const session = this.session;
        if (!session || !session.active || (contextKey && session.contextKey !== contextKey)) {
            throw new Error("No matching active audio session");
        }
        return session;
    }

    maybeWarn(session, direction) {
        const now = Date.now();
        if (now - this.lastWarningAt < 5000) return;
        const stats = session[direction].stats;
        const main =
            direction === "capture"
                ? {
                      backpressureDroppedFrames: session.capture.backpressureDroppedBlocks * 128,
                      invalidBlocks: session.capture.invalidBlocks,
                      sequenceGaps: session.capture.sequenceGaps
                  }
                : {
                      creditDroppedFrames: session.playback.creditDroppedBlocks * 128,
                      trailingBytes: session.playback.trailingBytes
                  };
        const mainGlitches = Object.values(main).reduce((total, value) => total + value, 0);
        const glitches = mainGlitches + (stats.creditStarvedFrames || 0) + (stats.underrunFrames || 0) + (stats.overrunFrames || 0) + (stats.hardResyncs || 0);
        if (glitches > 0) {
            this.lastWarningAt = now;
            console.warn("[audio-transport] " + direction + " glitches for " + session.contextKey + ": " + JSON.stringify({ worklet: stats, main }));
        }
    }

}

export default AudioTransport;
