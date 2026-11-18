import { it, expect } from "vitest";
import { normalizeAudioConfig, serverUrl } from "../../est-gui/src/main/lib/clientConfig.js";

it("both audio backends use audio.devices and preserve backend defaults", () => {
    expect(normalizeAudioConfig({})).toEqual({ backend: "native", devices: { source: "default", sink: "default" }, recordingDir: null });
    expect(normalizeAudioConfig({ audio: { backend: "stdio" } }).devices).toEqual({ source: "", sink: "" });
    for (const backend of ["native", "stdio"]) {
        expect(normalizeAudioConfig({ audio: { backend, devices: { source: "selected-input", sink: "selected-output" } } }).devices).toEqual({ source: "selected-input", sink: "selected-output" });
    }
    expect(() => normalizeAudioConfig({ audio: { backend: "webrtc" } })).toThrow();
});

it("server URLs require an HTTP(S) origin", () => {
    expect(serverUrl({ url: "https://study.example/" })).toBe("https://study.example");
    expect(serverUrl({ url: "http://[::1]:3000" })).toBe("http://[::1]:3000");
    for (const url of [undefined, "", "file:///etc/passwd", "https://user:secret@study.example/", "https://study.example/path", "https://study.example/?query", "http://study.example/#bad"]) {
        expect(() => serverUrl({ url })).toThrow();
    }
});

it.each([
    { ipAddress: "::1", port: 3000 },
    { url: "http://localhost:3000", ipAddress: "::1" },
    { url: "http://localhost:3000", port: 3000 },
    { url: "http://localhost:3000", typo: true }
])("server URLs reject unsupported address fields: %j", server => {
    expect(() => serverUrl(server)).toThrow();
});
