const path = require("path");

function buildPretestFormFilename(clientId) {
    return buildSafeFilename(clientId + "-pretest-form.json");
}

function buildRecordingFilename(clientId, testType, roundSuffix, fileName) {
    return buildSafeFilename(clientId + "-" + testType + roundSuffix + "-" + fileName);
}

function buildScaleFilename(clientId, testType, roundSuffix) {
    return buildSafeFilename(clientId + "-" + testType + roundSuffix + "-scales.json");
}

function buildSafeFilename(filename) {
    if (!isSafeFilename(filename)) {
        throw new Error("Unsafe generated filename: " + filename);
    }
    return filename;
}

function isSafeFilename(filename) {
    // Reject values that are not strings or that exceed the file name length limits
    if (typeof filename !== "string" || filename.length === 0 || filename.length > 255) return false;

    // Reject relative directory references and null bytes
    if (filename === "." || filename === ".." || filename.includes("\0")) return false;

    // Reject values that contain a POSIX or Windows path separator
    return path.posix.basename(filename) === filename && path.win32.basename(filename) === filename;
}

module.exports = { buildPretestFormFilename, buildRecordingFilename, buildScaleFilename, isSafeFilename };
