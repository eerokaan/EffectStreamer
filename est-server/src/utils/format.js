function padNumber(value, width) {
    return String(value).padStart(width, "0");
}

function formatConditionDirName(conditionNumber) {
    return "condition_" + padNumber(conditionNumber, 4);
}

module.exports = { formatConditionDirName, padNumber };
