export class BrowserDevices {
    constructor({ mediaDevices = globalThis.navigator?.mediaDevices, playback, AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, testAsset, testDurationMs = 1000, testTimeoutMs = 35000, onInvalidated = () => {} } = {}) {
        this.mediaDevices = mediaDevices; this.playback = playback; this.AudioContext = AudioContext;
        this.testAsset = testAsset; this.testDurationMs = testDurationMs; this.onInvalidated = onInvalidated;
        this.testTimeoutMs = testTimeoutMs;
        this.selection = { sourceId: "default", sinkId: "default" }; this.active = false;
        this.changed = () => {this.invalidate();this.onInvalidated();};
        mediaDevices?.addEventListener?.("devicechange", this.changed);
    }
    element() {
        this.playback ||= new Audio();
        this.playback.autoplay = false; this.playback.playsInline = true;
        return this.playback;
    }
    assertIdle() { if (this.active) throw new Error("Devices cannot change during an active attempt"); }
    setActive(active) { this.active = active; }
    invalidate() { this.tested = null; }
    async authorizeContext() {
        if (!this.AudioContext) throw new Error("Web Audio is unavailable");
        this.context ||= new this.AudioContext({ sampleRate: 48000 });
        await this.context.resume();return this.context;
    }
    async acquire(selection = this.selection) {
        if (!this.mediaDevices?.getUserMedia) throw new Error("Microphone access requires a supported desktop browser and HTTPS");
        const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 },
            ...(selection.sourceId !== "default" ? { deviceId: { exact: selection.sourceId } } : {}) };
        const stream = await this.mediaDevices.getUserMedia({ audio, video: false });
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState !== "live") {stream.getTracks().forEach(track => track.stop());throw new Error("Microphone has no usable live audio track");}
        const settings = track.getSettings();
        this.processing = Object.fromEntries(["echoCancellation", "noiseSuppression", "autoGainControl"].map(key => [key, typeof settings[key] === "boolean" ? settings[key] : "unknown"]));
        return stream;
    }
    async list() {
        this.assertIdle(); this.invalidate();
        // Called by the setup button, never automatically on page load.
        const stream = await this.acquire();
        try {
            const found = await this.mediaDevices.enumerateDevices();
            const entries = kind => found.filter(device => device.kind === kind && device.deviceId && device.deviceId !== "default").map(device => ({ id: device.deviceId, label: device.label || "Unnamed audio device" }));
            const inputs = [{ id: "default", label: "System default microphone", isDefault: true }, ...entries("audioinput")];
            const outputs = [{ id: "default", label: "System default output", isDefault: true }, ...(typeof this.element().setSinkId === "function" ? entries("audiooutput") : [])];
            if (this.permittedOutput && !outputs.some(device => device.id === this.permittedOutput.id)) outputs.push(this.permittedOutput);
            return { inputs, outputs, selection: { ...this.selection } };
        }
        finally { stream.getTracks().forEach(track => track.stop()); }
    }
    async chooseOutput() {
        this.assertIdle();this.invalidate();
        if (!this.mediaDevices?.selectAudioOutput) throw new Error("Output permission selection is unavailable; use the output menu or system default");
        const device = await this.mediaDevices.selectAudioOutput();
        this.permittedOutput = { id: device.deviceId, label: device.label || "Permitted output" };
        return this.permittedOutput;
    }
    async selectOutput(element, id) {
        if (typeof id !== "string" || !id) throw new Error("Select an output route");
        if (typeof element.setSinkId !== "function") {
            if (id !== "default") throw new Error("This browser exposes only system-default output routing");
            return;
        }
        await element.setSinkId(id === "default" ? "" : id);
    }
    async inputLevel(stream, onLevel) {
        if (!this.AudioContext) throw new Error("Web Audio input checks are unavailable");
        const context = await this.authorizeContext(), source = context.createMediaStreamSource(stream), analyser = context.createAnalyser();
        analyser.fftSize = 1024; source.connect(analyser); // No audible destination.
        let timer, peak = 0;
        try {
            await context.resume();
            const sample = () => {const data = new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);let current = 0;for (const value of data) current = Math.max(current, Math.abs(value));peak = Math.max(peak, current);onLevel(current);};
            sample();timer = setInterval(sample, 50);
            await new Promise(resolve => setTimeout(resolve, this.testDurationMs));
            return peak;
        }
        finally { clearInterval(timer);source.disconnect(); }
    }
    async test(selection, { onLevel = () => {} } = {}) {
        this.assertIdle();this.invalidate();
        const element = this.element(); let stream, timer, cancelled = false;
        try {
            const operation = (async () => {
            await this.authorizeContext();
            await this.selectOutput(element, selection.sinkId);
            element.srcObject = null;element.src = this.testAsset;
            const ended = new Promise((resolve, reject) => {element.onended = resolve;element.onerror = () => reject(new Error("P.501 test playback failed"));});
            void ended.catch(() => {});
            // Keep this user-authorized element for later WebRTC playback.
            await element.play();
            stream = await this.acquire(selection);
            if (cancelled) {stream.getTracks().forEach(track => track.stop());throw new Error("Device test cancelled");}
            const [peak] = await Promise.all([this.inputLevel(stream, onLevel), ended]);
            if (stream.getAudioTracks()[0].readyState !== "live") throw new Error("Microphone was removed during its test");
            this.tested = { ...selection };
            return { inputUsable: true, playbackComplete: true, peak, processing: this.processing };
            })();
            return await Promise.race([operation, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error("Device test timed out")), this.testTimeoutMs);})]);
        }
        finally { cancelled = true;clearTimeout(timer);element.pause();element.onended = null;element.onerror = null;stream?.getTracks().forEach(track => track.stop()); }
    }
    async save(selection) {
        this.assertIdle();
        if (!this.tested || this.tested.sourceId !== selection.sourceId || this.tested.sinkId !== selection.sinkId) throw new Error("Test the selected devices before continuing");
        this.selection = { ...selection };return { ...selection };
    }
    async dispose() { this.mediaDevices?.removeEventListener?.("devicechange", this.changed);this.playback?.pause();await this.context?.close(); }
}
