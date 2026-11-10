import { app } from "electron";
import fs from "fs";
import net from "net";
import path from "path";
import clientConfig from "@effectstreamer/common/client-config";
import { writeFileDirect } from "@effectstreamer/common/direct-write";

const configFileName = "est-gui.config.json";
const clientIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

function getGuiConfigPath() {
    return path.join(app.getPath("home"), "effectstreamer", configFileName);
}

function validateConfig(config, configPath) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("The GUI configuration must contain a JSON object: " + configPath);
    }
    const url = clientConfig.serverUrl(config.server);
    if (!config.client || typeof config.client.identity !== "string" || !clientIdPattern.test(config.client.identity.trim())) {
        throw new Error("Missing or invalid client configuration in " + configPath);
    }
    const clientIpAddress = typeof config.client.ipAddress === "string" ? config.client.ipAddress.trim() : "";
    if (clientIpAddress.length > 45 || net.isIP(clientIpAddress) === 0) {
        throw new Error("Missing or invalid client IP address in " + configPath);
    }
    if (config.client.audioDevices != null && (typeof config.client.audioDevices !== "object" || Array.isArray(config.client.audioDevices))) {
        throw new Error("Invalid client.audioDevices configuration in " + configPath);
    }

    return {
        ...config,
        server: {
            ...config.server,
            url,
            ipAddress: config.server.ipAddress?.trim(),
            port: config.server.port == null ? undefined : Number(config.server.port)
        },
        audio: clientConfig.normalizeAudioConfig(config),
        client: {
            ...config.client,
            identity: config.client.identity.trim(),
            ipAddress: clientIpAddress
        }
    };
}

async function readGuiConfig(configPath = getGuiConfigPath()) {
    let text;
    try {
        text = await fs.promises.readFile(configPath, "utf8");
    }
    catch (error) {
        throw new Error("Unable to read the GUI configuration at " + configPath + ": " + error.message);
    }

    try {
        return validateConfig(JSON.parse(text), configPath);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error("Invalid JSON in the GUI configuration at " + configPath + ": " + error.message);
        }
        throw error;
    }
}

function getAudioDeviceIds(config) {
    return clientConfig.normalizeAudioConfig(config).devices;
}

function validateDeviceId(value, name) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 1024) {
        throw new Error("Invalid audio " + name + " device ID");
    }
    return value;
}

async function saveAudioDeviceIds(configPath, deviceIds) {
    const source = validateDeviceId(deviceIds?.source, "source");
    const sink = validateDeviceId(deviceIds?.sink, "sink");
    const currentConfig = await readGuiConfig(configPath);
    const nextConfig = {
        ...currentConfig,
        ...(currentConfig.audio.backend === "native" ? { audio: { ...currentConfig.audio, devices: { source, sink } } } : {}),
        client: {
            ...currentConfig.client,
            audioDevices: {
                source,
                sink
            }
        }
    };
    await writeFileDirect(configPath, JSON.stringify(nextConfig, null, 4) + "\n");

    return nextConfig;
}

export { getAudioDeviceIds, getGuiConfigPath, readGuiConfig, saveAudioDeviceIds };
