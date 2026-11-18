const os = require("os");
const path = require("path");
const fs = require("fs");
const net = require("net");
const configManagerPretestForm = require("./configManagerPretestForm.js");
const { normalizeDeployment, publicBootstrap } = require("./deploymentConfig.js");
const { configError, validateObject, validateKnownKeys, normalizeString, normalizeNumeric } = require("../utils/validation.js");

const intMax = 2147483647;
const uintMax = 4294967295;
const conditionKeys = new Set(["nativeDelay", "nativeGain", "echoDelay", "echoGain", "packetlossType", "packetlossRatio", "packetlossSeed", "packetlossBurstModel", "packetlossBurstRatio"]);

const numericConditionFields = {
    nativeDelay: { integer: true, min: 0, max: intMax },
    nativeGain: { min: 0, max: 1 },
    echoDelay: { integer: true, min: 0, max: intMax },
    echoGain: { min: 0, max: 1 },
    packetlossRatio: { min: 0, max: 1 },
    packetlossSeed: { integer: true, min: 0, max: uintMax },
    packetlossBurstRatio: { min: 1, max: 8 }
};

// =======================================
// ===== Externally facing ===============
// =======================================

function loadConfig() {
    const configPath = process.env.EST_CONFIG_PATH || path.join(os.homedir(), "effectstreamer", "est-server.config.json");
    let configFile = null;
    let parsedConfig = null;

    // Load stage: Read the config file
    try {
        configFile = fs.readFileSync(configPath, "UTF-8");
    }
    catch (error) {
        throw new Error("Unable to read " + configPath + ": " + error.message);
    }

    // Load stage: Parse the config file as JSON
    try {
        parsedConfig = JSON.parse(configFile);
    }
    catch (error) {
        throw new Error("Unable to parse " + configPath + " as JSON: " + error.message);
    }

    if (process.env.EST_TURN_SECRET !== undefined) {
        validateObject(parsedConfig, "config");
        parsedConfig.remote ??= {};
        validateObject(parsedConfig.remote, "remote");
        parsedConfig.remote.turnSecret = process.env.EST_TURN_SECRET;
    }
    return normalizeConfig(parsedConfig);
}

function normalizeConfig(parsedConfig) {
    // Validate step: Enforce the known top-level keys
    validateObject(parsedConfig, "config");
    validateKnownKeys(parsedConfig, ["server", "remote", "prolific", "sessions", "tests", "conditions", "pretestForm"], "config");
    const server = normalizeServerConfig(parsedConfig.server);

    // Return step
    return {
        server,
        tests: normalizeTestsConfig(parsedConfig.tests),
        conditions: normalizeConditionsConfig(parsedConfig.conditions),
        pretestForm: configManagerPretestForm.normalizeConfig(parsedConfig.pretestForm),
        ...normalizeDeployment(parsedConfig, server)
    };
}

// ============================================
// ===== Internal normalization ===============
// ============================================

function normalizeServerConfig(serverConfig) {
    validateObject(serverConfig, "server");
    validateKnownKeys(serverConfig, ["ipAddress", "port", "mode", "maxActivePairs"], "server");

    // Validate step: Enforce a valid IP address
    const ipAddress = normalizeString(serverConfig.ipAddress, "server.ipAddress");
    if (ipAddress.length > 45 || net.isIP(ipAddress) === 0) {
        configError("server.ipAddress", "must be a valid IPv4 or IPv6 address");
    }

    // Normalize step: Determine the port number
    const port = normalizeNumeric(serverConfig.port, "server.port", { allowString: true, integer: true, min: 1, max: 65535 });
    const mode = serverConfig.mode === undefined ? "local" : serverConfig.mode;
    if (!["local", "remote"].includes(mode)) configError("server.mode", "must be local or remote");
    const maxActivePairs = normalizeNumeric(serverConfig.maxActivePairs === undefined ? 1 : serverConfig.maxActivePairs, "server.maxActivePairs", { integer: true, min: 1, max: 1000 });

    // Return step
    return { ipAddress, port, mode, maxActivePairs };
}

function normalizeTestsConfig(testsConfig) {
    validateObject(testsConfig, "tests");
    const testKeys = ["short-conversation-test", "listening-speaking-test"];
    validateKnownKeys(testsConfig, testKeys, "tests");

    // Validate step: Enforce the test keys to be booleans
    for (const testKey of testKeys) {
        if (typeof testsConfig[testKey] !== "boolean") {
            configError("tests." + testKey, "must be a boolean");
        }
    }

    // Return step
    return {
        sct: testsConfig["short-conversation-test"],
        lst: testsConfig["listening-speaking-test"]
    };
}

function normalizeConditionsConfig(conditionsConfig) {
    validateObject(conditionsConfig, "conditions");
    const conditionTypes = ["baseline", "random"];
    validateKnownKeys(conditionsConfig, conditionTypes, "conditions");

    // Validate step: Enforce the condition type shapes (baseline and random)
    if (!Array.isArray(conditionsConfig.baseline) || conditionsConfig.baseline.length !== 1) {
        configError("conditions.baseline", "must be an array containing exactly one condition");
    }
    if (!Array.isArray(conditionsConfig.random)) {
        configError("conditions.random", "must be an array");
    }

    // Return step
    return {
        baseline: conditionsConfig.baseline.map((condition, index) => normalizeSingularCondition(condition, "conditions.baseline[" + index + "]")),
        random: conditionsConfig.random.map((condition, index) => normalizeSingularCondition(condition, "conditions.random[" + index + "]"))
    };
}

function normalizeSingularCondition(condition, conditionPath) {
    validateObject(condition, conditionPath);
    validateKnownKeys(condition, conditionKeys, conditionPath);

    // Normalize step: Create output object (All properties are numeric, except packetlossType and packetlossBurstModel)
    const normalizedCondition = {};

    for (const [key, value] of Object.entries(condition)) {
        const fieldPath = conditionPath + "." + key;

        if (numericConditionFields[key]) {
            normalizedCondition[key] = normalizeNumeric(value, fieldPath, { ...numericConditionFields[key], allowString: true });
        }
        else if (key === "packetlossType") {
            const packetlossType = normalizeString(value, fieldPath);
            if (!["none", "random", "bursty"].includes(packetlossType)) {
                configError(fieldPath, "must be one of: none, random, bursty");
            }
            normalizedCondition[key] = packetlossType;
        }
        else if (key === "packetlossBurstModel") {
            const burstModel = normalizeString(value, fieldPath);
            if (burstModel !== "g107-markov") {
                configError(fieldPath, "must be g107-markov");
            }
            normalizedCondition[key] = burstModel;
        }
    }

    // Validate step: Enforce consistent packet-loss fields
    const packetlossType = normalizedCondition.packetlossType ?? "none";
    const packetlossRatio = normalizedCondition.packetlossRatio ?? 0;

    if (packetlossType === "none" && packetlossRatio > 0) {
        configError(conditionPath, "packetlossRatio above 0 requires packetlossType random or bursty");
    }

    // Return step
    return normalizedCondition;
}

module.exports = { loadConfig, normalizeConfig, publicBootstrap };
