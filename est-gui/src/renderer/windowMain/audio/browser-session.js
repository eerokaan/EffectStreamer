export class BrowserAudioSession {
    constructor({ devices, RTCPeerConnection = globalThis.RTCPeerConnection, MediaStream = globalThis.MediaStream, onFailure = () => {}, timeoutMs = 30000 } = {}) {
        this.devices = devices; this.Peer = RTCPeerConnection; this.Stream = MediaStream; this.onFailure = onFailure; this.timeoutMs = timeoutMs;
        this.peers = new Map();this.generation = null;this.stopping = false;
    }
    async prepare({ scope, generation, iceServers, signal }) {
        if (this.generation) throw new Error("Another browser audio attempt is active");
        this.scope = { ...scope };this.generation = generation;this.stopping = false;this.pending = new Map();
        this.devices.setActive(true);
        try {
            this.microphone = await this.devices.acquire();
            if (this.stopping) throw new Error("Browser media preparation cancelled");
            this.microphone.getAudioTracks().forEach(track => {track.enabled = false;track.addEventListener?.("ended", () => {if (!this.stopping) this.onFailure(new Error("Microphone disconnected"));});});
            const playback = this.devices.element();playback.src = "";
            await this.devices.selectOutput(playback, this.devices.selection.sinkId);
            const connected = new Map();let acceptTrack, rejectTrack;
            const received = new Promise((resolve, reject) => {acceptTrack = resolve;rejectTrack = reject;});
            // Both objects exist before signaling starts, including early ICE.
            for (const connectionId of ["uplink", "downlink"]) {
                const peer = new this.Peer({ iceServers });this.peers.set(connectionId, peer);this.pending.set(connectionId, []);
                const current = () => !this.stopping && this.generation === generation;
                peer.onicecandidate = event => {
                    if (!current()) return;
                    const candidate = event.candidate?.toJSON ? event.candidate.toJSON() : event.candidate;
                    void signal({ connectionId, generation, type: "ice", candidate: candidate?.candidate || null, sdpMLineIndex: candidate?.sdpMLineIndex ?? 0 }).catch(error => {if (current()) this.onFailure(error);});
                };
                connected.set(connectionId, new Promise((resolve, reject) => {
                    peer.onconnectionstatechange = () => {
                        if (!current()) return;
                        if (peer.connectionState === "connected") resolve();
                        if (["failed", "disconnected"].includes(peer.connectionState)) {const error = new Error("WebRTC " + connectionId + " " + peer.connectionState);reject(error);this.onFailure(error);}
                    };
                }));
                if (connectionId === "uplink") peer.addTransceiver(this.microphone.getAudioTracks()[0], { direction: "sendonly", streams: [this.microphone] });
                else {
                    peer.addTransceiver("audio", { direction: "recvonly" });
                    peer.ontrack = event => {
                        if (!current()) return;
                        this.playback = event.streams?.[0] || new this.Stream([event.track]);
                        playback.srcObject = this.playback;
                        Promise.resolve(playback.play()).then(acceptTrack, rejectTrack);
                    };
                }
            }
            let timer;
            const operations = Promise.all([...this.peers].map(async ([connectionId, peer]) => {
                const offer = await peer.createOffer();await peer.setLocalDescription(offer);
                const answer = await signal({ connectionId, generation, type: "offer", sdp: peer.localDescription.sdp });
                if (this.stopping || this.generation !== generation) throw new Error("Browser media preparation cancelled");
                if (answer?.type !== "answer" || typeof answer.sdp !== "string") throw new Error("Invalid WebRTC answer");
                await peer.setRemoteDescription(answer);
                for (const candidate of this.pending.get(connectionId) || []) await peer.addIceCandidate(candidate);
                this.pending.set(connectionId, []);
            }));
            try {
                await Promise.race([Promise.all([operations, received, ...connected.values()]), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error("Browser WebRTC preparation timed out")), this.timeoutMs);})]);
            }
            finally {clearTimeout(timer);}
        }
        catch (error) {await this.stop();throw error;}
    }
    async applySignal(message) {
        if (!this.generation || message.generation !== this.generation || this.stopping || Object.keys(this.scope).some(key => message[key] !== this.scope[key])) throw new Error("Stale browser media generation/scope");
        const peer = this.peers.get(message.connectionId);
        if (!peer || message.type !== "ice") throw new Error("Unknown browser media connection/signal");
        const candidate = message.candidate === null ? null : { candidate: message.candidate, sdpMLineIndex: message.sdpMLineIndex };
        if (!peer.remoteDescription) {
            const queued = this.pending.get(message.connectionId);
            if (queued.length >= 128) throw new Error("Browser ICE queue limit exceeded");
            queued.push(candidate);
        }
        else await peer.addIceCandidate(candidate);
    }
    streams() { return { microphone: this.microphone, playback: this.playback }; }
    async start() {
        if (!this.microphone || !this.playback || this.stopping) throw new Error("Browser streams are not prepared");
        await this.devices.element().play();
        this.microphone.getAudioTracks().forEach(track => {track.enabled = true;});
    }
    async stopCapture() { this.microphone?.getAudioTracks().forEach(track => {track.enabled = false;}); }
    async stop() {
        this.stopping = true; await this.stopCapture();
        for (const peer of this.peers.values()) {peer.onicecandidate = null;peer.ontrack = null;peer.onconnectionstatechange = null;peer.close();}
        this.peers.clear();this.microphone?.getTracks().forEach(track => track.stop());
        const element = this.devices.element();element.pause();element.srcObject = null;
        this.microphone = null;this.playback = null;this.generation = null;this.devices.setActive(false);
    }
}
