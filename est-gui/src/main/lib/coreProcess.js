import { spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import path from "path";
import managedCore from "@effectstreamer/common/core-process";
import {coreEnvironment} from "@effectstreamer/common/core-environment";

const coreReadyTimeoutMs = 10000;
const coreStopTimeoutMs = 5000;

function getOperatingSystem() {
    if (process.platform === "linux") return "linux";
    if (process.platform === "win32") return "windows";
    return null;
}

function getCoreSpawnOptions(component, { base = path.join(process.resourcesPath, "est-core") } = {}) {
    const platform = getOperatingSystem();
    const stdio = component === "sender" ? ["pipe", "ignore", "pipe"] : ["pipe", "pipe", "pipe"];

    const executable = path.join(base, platform === 'windows' ? 'est-core.exe' : 'est-core');
    if (platform === "linux" || platform === "windows") return {executable, options: {stdio, env: coreEnvironment({executable})}};
    throw new Error("Unsupported platform: " + process.platform);
}

function spawnCore(component, args, { deadline = null, onSpawn = () => {}, onFatal = () => {}, spawnOptions = null } = {}) {
    if (component !== "sender" && component !== "receiver") {
        throw new Error("Unsupported est-core component: " + component);
    }
    if (deadline != null && Date.now() >= deadline) throw new Error("Timed out before starting est-core " + component);

    const { executable, options } = spawnOptions || getCoreSpawnOptions(component);
    const child = spawn(executable, args, options);
    let resolveExit;
    let rejectReady;
    let resolveReady;
    let stderrBuffer = "";
    const stderrDecoder = new StringDecoder("utf8");
    const readyMarker = "EST_CORE_READY " + component;
    const record = {
        child,
        component,
        ready: false,
        started: false,
        intentionalStop: false,
        runtimeError: null,
        exitCode: null,
        signalCode: null,
        graceful: false,
        stopTimedOut: false,
        readyAt: null,
        fatalReported: false,
        exitPromise: new Promise((resolve) => {
            resolveExit = resolve;
        })
    };
    const readyPromise = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    let readyTimeout = null;
    const reportFailure = (source, error) => {
        if (record.intentionalStop) return;
        const failure = new Error("est-core " + component + " " + source + " failure: " + error.message);
        if (!record.runtimeError) record.runtimeError = failure.message;
        if (!record.ready) {
            rejectReady(failure);
            if (readyTimeout) clearTimeout(readyTimeout);
        }
        else if (record.started && !record.fatalReported) {
            record.fatalReported = true;
            onFatal(failure, record);
        }
    };
    record.handleStreamFailure = reportFailure;

    for (const [name, stream] of [
        ["stdin", child.stdin],
        ["stdout", child.stdout]
    ]) {
        if (!stream) continue;
        stream.on("error", (error) => reportFailure(name, error));
        stream.on("close", () => {
            if (!record.intentionalStop && child.exitCode === null && child.signalCode === null) {
                reportFailure(name, new Error("stream closed while the process was running"));
            }
        });
    }

    child.stderr.on("error", (error) => reportFailure("stderr", error));

    const readyTimeoutMs = deadline == null ? coreReadyTimeoutMs : Math.max(1, deadline - Date.now());
    readyTimeout = setTimeout(() => {
        if (record.ready) return;
        record.intentionalStop = true;
        child.kill();
        rejectReady(new Error("Timed out waiting for " + readyMarker));
    }, readyTimeoutMs);

    function processStderrLine(line) {
        const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (normalized.length > 0) console.error("[est-core " + component + "] " + normalized);

        if (!record.ready && normalized === readyMarker) {
            record.ready = true;
            record.readyAt = new Date().toISOString();
            clearTimeout(readyTimeout);
            resolveReady(record);
        }
    }

    child.stderr.on("data", (chunk) => {
        stderrBuffer += stderrDecoder.write(chunk);
        let lineEnd = stderrBuffer.indexOf("\n");
        while (lineEnd !== -1) {
            processStderrLine(stderrBuffer.slice(0, lineEnd));
            stderrBuffer = stderrBuffer.slice(lineEnd + 1);
            lineEnd = stderrBuffer.indexOf("\n");
        }
    });

    child.once("error", (error) => reportFailure("process", error));

    child.once("close", (code, signal) => {
        clearTimeout(readyTimeout);
        const finalText = stderrBuffer + stderrDecoder.end();
        if (finalText.length > 0) processStderrLine(finalText);
        record.exitCode = code;
        record.signalCode = signal;
        resolveExit(record);

        if (!record.ready) {
            rejectReady(new Error("est-core " + component + " exited before readiness with code " + code + (signal ? " (" + signal + ")" : "")));
        }
        else if (!record.intentionalStop) {
            record.runtimeError ||= "est-core " + component + " exited unexpectedly with code " + code + (signal ? " (" + signal + ")" : "");
            if (record.started && !record.fatalReported) {
                record.fatalReported = true;
                onFatal(new Error(record.runtimeError), record);
            }
        }
    });

    onSpawn(record);
    return readyPromise;
}

function markCoreStarted(record) {
    if (!record || record.child.exitCode !== null || record.child.signalCode !== null || record.runtimeError) {
        throw new Error(record?.runtimeError || "est-core exited during startup");
    }
    record.started = true;
}

async function stopCore(record) {
    if (!record) return null;
    record.intentionalStop = true;

    if (record.child.exitCode !== null || record.child.signalCode !== null) {
        record.graceful = record.child.exitCode === 0;
        return record;
    }

    record.child.stdin.end();

    const exited = await Promise.race([
        record.exitPromise.then(() => true),
        new Promise((resolve) => {
            setTimeout(() => resolve(false), coreStopTimeoutMs);
        })
    ]);

    if (!exited) {
        record.stopTimedOut = true;
        const killed = record.child.kill("SIGKILL");
        if (!killed && record.child.exitCode === null && record.child.signalCode === null) {
            throw new Error("Unable to terminate est-core " + record.component);
        }
        await record.exitPromise;
    }

    record.graceful = !record.stopTimedOut && record.exitCode === 0;
    return record;
}

function isLittleEndian() {
    const bytes = new Uint8Array(new Uint16Array([0x00ff]).buffer);
    return bytes[0] === 0xff;
}

const startManagedCore = managedCore.startCore;
export { getOperatingSystem, getCoreSpawnOptions, isLittleEndian, markCoreStarted, spawnCore, stopCore, startManagedCore };
