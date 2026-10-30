const fs = require('node:fs');
const path = require('node:path');

function coreEnvironment({executable, env = process.env, platform = process.platform}) {
    const root = path.join(path.dirname(path.resolve(executable)), 'gst-lib', platform === 'win32' ? 'x86_64-windows' : 'x86_64-linux-gnu');
    const lib = path.join(root, 'lib'), plugins = path.join(lib, 'gstreamer-1.0');
    if (!fs.existsSync(plugins)) return {...env}; // Explicit source/development SDK.
    const result = {...env, GST_PLUGIN_PATH: plugins, GST_PLUGIN_SYSTEM_PATH: plugins};
    if (platform === 'linux') result.LD_LIBRARY_PATH = lib;
    if (platform === 'win32') result.PATH = path.join(root, 'bin') + ';' + (env.PATH || '');
    const scanner = path.join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner' + (platform === 'win32' ? '.exe' : ''));
    delete result.GST_PLUGIN_SCANNER;
    if (fs.existsSync(scanner)) result.GST_PLUGIN_SCANNER = scanner;
    return result;
}
module.exports = {coreEnvironment};
