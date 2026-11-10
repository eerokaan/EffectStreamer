function normalizeAudioConfig(config) {
    const audio = config.audio ?? {};
    if (!audio || typeof audio !== 'object' || Array.isArray(audio)) throw new Error('Invalid audio configuration');
    const backend = audio.backend ?? 'native';
    if (!['native','stdio'].includes(backend)) throw new Error('Invalid audio.backend');
    const selected = backend === 'native' ? audio.devices : config.client?.audioDevices;
    const devices = {};
    for (const track of ['source','sink']) {
        const value = selected?.[track] ?? (backend === 'native' ? 'default' : '');
        if (typeof value !== 'string' || value.length > 1024 || value.includes('\0') || (backend === 'native' && !value.trim())) throw new Error('Invalid audio device ' + track);
        devices[track] = value;
    }
    const recordingDir = audio.recordingDir ?? null;
    if (recordingDir !== null && (typeof recordingDir !== 'string' || !recordingDir.trim() || recordingDir.includes('\0'))) throw new Error('Invalid audio.recordingDir');
    return {backend,devices,recordingDir};
}
function serverUrl(server) {
    if (!server || typeof server !== 'object') throw new Error('Invalid server configuration');
    let value = server.url;
    if (value == null) {
        if (typeof server.ipAddress !== 'string' || !server.ipAddress.trim() || !Number.isInteger(Number(server.port)) || Number(server.port)<1 || Number(server.port)>65535) throw new Error('Invalid server address/port');
        const host = server.ipAddress.trim();
        value = `http://${host.includes(':') ? '[' + host + ']' : host}:${Number(server.port)}`;
    }
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid server URL: use an HTTP(S) origin without credentials');
    return url.origin;
}
module.exports = {normalizeAudioConfig,serverUrl};
