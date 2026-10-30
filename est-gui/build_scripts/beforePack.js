const fs = require('node:fs/promises');
const path = require('node:path');
const {stageRuntime} = require('../../est-core/build_scripts/stage-runtime.cjs');

module.exports = async function(context) {
    const target = context.electronPlatformName === 'win32' ? 'win' : context.electronPlatformName;
    if (!['linux', 'win'].includes(target)) throw new Error('Native packaging supports Linux and Windows only');
    const project = path.resolve(__dirname, '..');
    let resources = process.env.EST_GUI_CORE_RESOURCES;
    if (!resources) {
        await fs.mkdir(path.join(project, 'out'), {recursive: true});
        const work = await fs.mkdtemp(path.join(project, 'out', 'native-resources-'));
        resources = path.join(work, 'core');
        await stageRuntime({target, sdk:process.env.SDK, netsimPlugin:process.env.EST_NETSIM_PLUGIN,
            executable:process.env.EST_CORE_EXECUTABLE || path.resolve(project, '../est-core/.build', target, target === 'win' ? 'est-core.exe' : 'est-core'), destination:resources});
    }
    await fs.access(path.join(resources, target === 'win' ? 'est-core.exe' : 'est-core'));
    const triple = target === 'win' ? 'x86_64-windows' : 'x86_64-linux-gnu';
    await fs.access(path.join(resources, 'gst-lib', triple, 'lib/gstreamer-1.0', target === 'win' ? 'libestnetsim.dll' : 'libestnetsim.so'));
    context.packager.config.extraResources ||= [];
    context.packager.config.extraResources.push({from:path.resolve(resources), to:'est-core'});
};
