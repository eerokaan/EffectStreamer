function validateKeys(value, keys, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid " + name + " configuration");
    }
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) throw new Error(name + "." + key + " is unknown");
    }
}

function normalizeAudioConfig(config) {
    const audio = config.audio ?? {};
    validateKeys(audio, ["backend", "devices", "recordingDir"], "audio");
    const backend = audio.backend ?? "native";
    if (!["native", "stdio"].includes(backend)) {
        throw new Error("Invalid audio.backend");
    }
    const selected = audio.devices ?? {};
    validateKeys(selected, ["source", "sink"], "audio.devices");
    const devices = {};
    for (const track of ["source", "sink"]) {
        const value = selected?.[track] ?? (backend === "native" ? "default" : "");
        if (typeof value !== "string" || value.length > 1024 || value.includes("\0") || (backend === "native" && !value.trim())) {
            throw new Error("Invalid audio device " + track);
        }
        devices[track] = value;
    }
    const recordingDir = audio.recordingDir ?? null;
    if (recordingDir !== null && (typeof recordingDir !== "string" || !recordingDir.trim() || recordingDir.includes("\0"))) {
        throw new Error("Invalid audio.recordingDir");
    }
    return { backend, devices, recordingDir };
}

function serverUrl(server) {
    validateKeys(server, ["url"], "server");
    if (typeof server.url !== "string") throw new Error("Invalid server.url");
    const url = new URL(server.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("Invalid server URL: use an HTTP(S) origin without credentials");
    }
    return url.origin;
}

export { normalizeAudioConfig, serverUrl, validateKeys };
