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

module.exports = { coreExecutable };
