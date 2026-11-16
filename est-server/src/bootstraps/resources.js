const path = require("node:path");
const { isSea } = require("node:sea");
const { checkoutPaths } = require("@effectstreamer/common/transient-paths");

function coreExecutable({ packaged = isSea(), platform = process.platform, executable = process.execPath } = {}) {
    const name = platform === "win32" ? "est-core.exe" : "est-core";
    if (packaged) {
        const paths = platform === "win32" ? path.win32 : path.posix;
        return paths.join(paths.dirname(executable), "core", name);
    }
    return checkoutPaths().path("est-core", "build", platform === "win32" ? "win" : "linux", name);
}

function resources(config) {
    const base = path.dirname(process.execPath);
    config.remote.coreExecutable = coreExecutable();
    return {
        config,
        ...(process.env.EST_RESULTS_ROOT ? { root: path.resolve(process.env.EST_RESULTS_ROOT) } : {}),
        ...(config.deployment.mode === "remote" ? { webRoot: path.resolve(process.env.EST_WEB_ROOT || (isSea() ? path.join(base, "web") : checkoutPaths().path("est-gui", "web"))) } : {})
    };
}
module.exports = { resources, coreExecutable };
