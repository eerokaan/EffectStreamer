function configError(configPath, message) {
    throw new Error("[Config] " + configPath + " " + message);
}

function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function validateObject(value, configPath) {
    if (!isObject(value)) {
        configError(configPath, "must be an object");
    }
}

function validateKnownKeys(value, allowedKeys, configPath) {
    const allowedKeySet = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
    for (const key of Object.keys(value)) {
        if (!allowedKeySet.has(key)) {
            configError(configPath + "." + key, "is unknown");
        }
    }
}

function normalizeString(value, configPath, isOptional = false, defaultValue = null) {
    if (value == null) {
        if (isOptional) return defaultValue;
        configError(configPath, "must be a non-empty string");
    }
    if (typeof value !== "string") {
        configError(configPath, "must be a string");
    }

    const trimmedValue = value.trim();
    if (trimmedValue.length > 0) return trimmedValue;
    if (isOptional) return defaultValue;

    configError(configPath, "must be a non-empty string");
}

function normalizeBoolean(value, configPath, isOptional = false, defaultValue = null) {
    if (value == null) {
        if (isOptional) return defaultValue;
        configError(configPath, "must be a boolean");
    }
    if (typeof value !== "boolean") {
        configError(configPath, "must be a boolean");
    }
    return value;
}

function normalizeNumeric(value, configPath, { allowString = false, integer = false, min, max } = {}) {
    let normalizedValue = value;

    if (allowString && typeof normalizedValue === "string") {
        const numericPattern = integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
        const trimmedValue = normalizedValue.trim();
        
        if (!numericPattern.test(trimmedValue)) {
            configError(configPath, "must be a numeric value");
        }
        normalizedValue = Number(trimmedValue);
    }

    if (typeof normalizedValue !== "number" || !Number.isFinite(normalizedValue)) {
        configError(configPath, allowString ? "must be a finite number or numeric string" : "must be a finite number");
    }
    if (integer && !Number.isInteger(normalizedValue)) {
        configError(configPath, "must be an integer");
    }
    if (min != null && max != null && (normalizedValue < min || normalizedValue > max)) {
        configError(configPath, "must be from " + min + " through " + max);
    }
    if (min != null && normalizedValue < min) {
        configError(configPath, "must be at least " + min);
    }
    if (max != null && normalizedValue > max) {
        configError(configPath, "must be at most " + max);
    }

    return normalizedValue;
}

module.exports = {
    configError,
    isObject,
    validateObject,
    validateKnownKeys,
    normalizeString,
    normalizeBoolean,
    normalizeNumeric
};
