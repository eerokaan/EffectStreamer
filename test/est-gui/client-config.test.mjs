import { it, expect } from "vitest";
import { normalizeAudioConfig, serverUrl } from "../../est-gui/src/main/lib/clientConfig.js";

it("native defaults cannot inherit saved browser IDs", () => {
    expect(normalizeAudioConfig({ client: { audioDevices: { source: "chromium-id", sink: "other" } } })).toEqual({ backend: "native", devices: { source: "default", sink: "default" }, recordingDir: null });
    expect(normalizeAudioConfig({ audio: { backend: "stdio" }, client: { audioDevices: { source: "browser" } } }).devices.source).toBe("browser");
    expect(normalizeAudioConfig({ audio: { backend: "native", devices: { source: "hw:0,1", sink: "default" } } }).devices.source).toBe("hw:0,1");
    expect(() => normalizeAudioConfig({ audio: { backend: "webrtc" } })).toThrow();
});

it("server URLs accept HTTPS or legacy IP/port but reject URL credentials and other protocols", () => {
    expect(serverUrl({ url: "https://study.example/" })).toBe("https://study.example");
    expect(serverUrl({ ipAddress: "::1", port: 3000 })).toBe("http://[::1]:3000");
    for (const url of ["file:///etc/passwd", "https://user:secret@study.example/", "https://study.example/path", "http://study.example/#bad"]) {
        expect(() => serverUrl({ url })).toThrow();
    }
});
