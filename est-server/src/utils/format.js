function padNumber(value, width) {
    return String(value).padStart(width, "0");
}

function formatSessionDirName(sessionNumber) {
    return "session_" + padNumber(sessionNumber, 4);
}

function parseSessionDirNumber(dirname) {
    if (!/^session_\d{4}$/.test(dirname)) return null;
    return Number(dirname.slice("session_".length));
}

function formatConditionDirName(conditionNumber) {
    return "condition_" + padNumber(conditionNumber, 4);
}

module.exports = { formatConditionDirName, formatSessionDirName, padNumber, parseSessionDirNumber };
