import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import dgram from "node:dgram";
import { NativeAudioRuntime } from "../../est-gui/src/main/audio/native.js";
import {checkoutPaths} from '../../common/transient-paths.cjs';

it.skipIf(process.env.EST_NATIVE_INTEGRATION !== "1")("runs two native participants with four real core processes and separate WAVs", async () => {
    const root = checkoutPaths().temporaryDirectory('est-gui','est-native-pair-');
    const sockets = Array.from({ length: 6 }, () => dgram.createSocket("udp4"));
    await Promise.all(sockets.map(socket => new Promise(resolve => socket.bind(0, "127.0.0.1", resolve))));
    const ports = sockets.map(socket => socket.address().port);
    await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
    const participants = [0, 1].map(index => new NativeAudioRuntime({
        config: { audio: { backend: "native", devices: { source: "null", sink: "null" } } },
        executable: checkoutPaths().path('est-core','build','linux','est-core'), platform: "linux", recordingRoot: root, setupSample: "unused"
    }));
    const scopes = ["person-a", "person-b"].map(participantId => ({ sessionId: "session-integration", attemptId: "attempt-1", participantId }));
    try {
        await Promise.all(participants.map(async (runtime, index) => {
            const endpoints = { listen: ports[index * 3], echo: ports[index * 3 + 1], record: ports[index * 3 + 2] };
            for (const component of ["sender", "receiver"]) await runtime.prepare({ scope: scopes[index], component, condition: { nativeDelay: 0, echoDelay: 0, echoGain: 0 }, peer: { ipAddress: "127.0.0.1", port: ports[(1 - index) * 3] }, ports: endpoints });
        }));
        const flowing = participants.map(runtime => new Promise(resolve => runtime.current.handles.receiver.on("media-ready", resolve)));
        await Promise.all(participants.map((runtime, index) => runtime.start(scopes[index])));
        await Promise.all(flowing);
        await new Promise(resolve => setTimeout(resolve, 100));
        await Promise.all(participants.map((runtime, index) => runtime.stop(scopes[index])));
        for (let index = 0; index < 2; index++) {
            const manifests = await participants[index].recordings(scopes[index]);
            expect(manifests).toHaveLength(2);
            for (const manifest of manifests) {
                expect(manifest.byteLength).toBeGreaterThan(44);
                const bytes = await fs.readFile(path.join(root, "session-integration", "attempt-1", scopes[index].participantId, manifest.filename));
                expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
            }
        }
    }
    finally {await Promise.all(participants.map(runtime => runtime.dispose().catch(() => {})));await fs.rm(root, { recursive: true, force: true });}
}, 20000);
