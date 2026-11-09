const fs = require('node:fs/promises');
const path = require('node:path');
const {stageRuntime} = require('../../est-core/build_scripts/stage-runtime.cjs');
const {checkoutPaths}=require('../../est-common/transient-paths.cjs');

module.exports = async function(context) {
    const target = context.electronPlatformName === 'win32' ? 'win' : context.electronPlatformName;
    if (!['linux', 'win'].includes(target)) throw new Error('Native packaging supports Linux and Windows only');
    const resources = process.env.EST_GUI_CORE_RESOURCES;
    const destination=path.join(context.appOutDir,'resources','est-core');
    if (!resources) {
        await stageRuntime({target, sdk:process.env.SDK, netsimPlugin:process.env.EST_NETSIM_PLUGIN,
            executable:process.env.EST_CORE_EXECUTABLE || checkoutPaths().path('est-core','build',target,target === 'win' ? 'est-core.exe' : 'est-core'), destination});
        return;
    }
    await fs.access(path.join(resources, target === 'win' ? 'est-core.exe' : 'est-core'));
    const triple = target === 'win' ? 'x86_64-windows' : 'x86_64-linux-gnu';
    await fs.access(path.join(resources, 'gst-lib', triple, 'lib/gstreamer-1.0', target === 'win' ? 'libestnetsim.dll' : 'libestnetsim.so'));
    await fs.mkdir(path.dirname(destination),{recursive:true});
    try {await fs.mkdir(destination,{mode:0o700});} catch(error) {if(error.code==='EEXIST')throw new Error('Refusing to overwrite existing resources: '+destination);throw error;}
    try {await fs.cp(path.resolve(resources),destination,{recursive:true,dereference:true,errorOnExist:true,force:false});}
    catch(error) {error.message+='; incomplete resources may remain at '+destination;throw error;}
};
