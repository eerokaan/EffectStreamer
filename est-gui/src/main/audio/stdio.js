import { NativeAudioRuntime, coreArguments } from "./native.js";
import { spawnCore, markCoreStarted } from "../lib/coreProcess.js";

// Retain the existing binary PCM worklets only behind the explicit stdio backend.
export class StdioAudioRuntime extends NativeAudioRuntime {
    constructor(options) { super(options); this.transport = options.transport; this.spawnOptions = options.spawnOptions; }
    async prepare({ scope, component, condition, peer, ports }) {
        if (this.current && this.current.scope.attemptId !== scope.attemptId) throw new Error("Another stdio attempt is active");
        this.current ||= { scope, handles: {} };
        if (component === "sender") {
            await this.transport.startSender(scope.attemptId, { source: { id: this.audio.devices.source, label: this.audio.devices.source }, sink: { id: this.audio.devices.sink, label: this.audio.devices.sink } });
        }
        else await this.transport.startReceiver(scope.attemptId);
        const args = coreArguments({ platform: this.platform, component, devices: this.audio.devices, condition, peer, ports, directory: this.directory(scope) });
        args.splice(args.indexOf("--device-id"), 2);
        args.splice(args.indexOf("--control"), 2);
        args[args.indexOf("--device-type") + 1] = "stdio";
        const record = await spawnCore(component, args, { spawnOptions: this.spawnOptions,
            onSpawn: core => this.transport.setCore(component, core),
            onFatal: error => this.onFailure(error)
        });
        this.current.handles[component] = record;
        markCoreStarted(record);this.transport.markComponentStarted(component);
        // stdio has no control channel: initial PCM establishes readiness.
        if (component === "sender") this.transport.enableCapture();
    }
    async start(scope) { this.requireAttempt(scope); }
    async stop(scope) {
        this.requireAttempt(scope);
        try { await this.transport.stop(); }
        finally { this.current = null; }
    }
}
