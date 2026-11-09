const path = require('node:path');
const {isSea} = require('node:sea');
const {checkoutPaths}=require('@effectstreamer/common/transient-paths');

function resources(config) {
    const base = isSea() ? path.dirname(process.execPath) : path.resolve(__dirname, '../..');
    const executable = config.remote.coreExecutable;
    config.remote.coreExecutable = path.isAbsolute(executable) ? executable : path.resolve(base, executable);
    return {
        config,
        ...(process.env.EST_RESULTS_ROOT ? {root: path.resolve(process.env.EST_RESULTS_ROOT)} : {}),
        ...(config.deployment.mode === 'remote' ? {webRoot: path.resolve(process.env.EST_WEB_ROOT || (isSea() ? path.join(base,'web') : checkoutPaths().path('est-gui','web')))} : {})
    };
}
module.exports = {resources};
