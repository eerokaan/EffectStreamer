const fs = require('node:fs');
const path = require('node:path');
const {createTransientPaths}=require('./transient-paths.cjs');

function coreEnvironment({executable, env = process.env, platform = process.platform}) {
    const paths=createTransientPaths({anchor:path.dirname(path.resolve(executable))});
    const result=paths.environment('est-core',env);
    result.GST_REGISTRY=path.join(paths.directory('est-core','cache','gstreamer'),'registry-'+platform+'.bin');
    result.GST_REGISTRY_1_0=result.GST_REGISTRY;
    const root = path.join(path.dirname(path.resolve(executable)), 'gst-lib', platform === 'win32' ? 'x86_64-windows' : 'x86_64-linux-gnu');
    const lib = path.join(root, 'lib'), plugins = path.join(lib, 'gstreamer-1.0');
    if (!fs.existsSync(plugins)) return result; // Preserve explicit source/development SDK settings.
    result.GST_PLUGIN_PATH=plugins;result.GST_PLUGIN_SYSTEM_PATH=plugins;
    if (platform === 'linux') result.LD_LIBRARY_PATH = lib;
    if (platform === 'win32') result.PATH = path.join(root, 'bin') + ';' + (env.PATH || '');
    const scanner = path.join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner' + (platform === 'win32' ? '.exe' : ''));
    delete result.GST_PLUGIN_SCANNER;
    if (fs.existsSync(scanner)) result.GST_PLUGIN_SCANNER = scanner;
    return result;
}
module.exports = {coreEnvironment};
