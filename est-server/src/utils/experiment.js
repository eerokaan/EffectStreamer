const { padNumber } = require("./format.js");

function getRoundSuffix(testType, conditionListeningSpeakingTestIndex) {
    return testType === "lst" ? "-r" + (conditionListeningSpeakingTestIndex + 1) : "";
}

function getExperimentCondition(config, conditionIndex, conditionOrder) {
    return conditionIndex === 0 ? config.conditions.baseline[0] : config.conditions.random[conditionOrder[conditionIndex - 1]];
}

function getRecordingContextKey(conditionIndex, testType, roundSuffix) {
    return "condition-" + padNumber(conditionIndex + 1, 4) + "-test-" + testType + roundSuffix;
}

module.exports = { getRoundSuffix, getExperimentCondition, getRecordingContextKey };
