const path = require("path");
const fs = require("fs");
const pretestForm = require("./pretestForm.js");

function resolveConfigPath(srcDir) {
    const configName = "est-config.json";
    const isSeaExecutable = (() => {
        try {
            return require("node:sea").isSea();
        }
        catch {
            return false;
        }
    })();

    if (isSeaExecutable) {
        return path.join(path.dirname(process.execPath), configName);
    }
    else {
        return path.join(srcDir, "..", configName);
    }
}

function loadConfig(configPath) {
    const estConfig = JSON.parse(fs.readFileSync(configPath, "UTF-8"));
    const pretestFormConfig = pretestForm.normalizeConfig(estConfig.pretestForm);

    const testConfigKeys = {
        sct: "short-conversation-test",
        lst: "listening-speaking-test"
    };
    const testEnabled = {
        sct: estConfig.tests?.[testConfigKeys.sct] !== false,
        lst: estConfig.tests?.[testConfigKeys.lst] !== false
    };

    return { estConfig, pretestFormConfig, testConfigKeys, testEnabled };
}

module.exports = { resolveConfigPath, loadConfig };
