const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

async function stageRuntime({target, sdk, executable, netsimPlugin, destination}) {
    if (!['linux', 'win'].includes(target)) throw new Error('TARGET_OS must be linux or win');
    if (!destination) throw new Error('A new destination directory is required');
    try {await fs.access(destination);throw new Error('Refusing to overwrite existing resources: ' + destination);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (!sdk || !executable || !netsimPlugin) throw new Error('SDK, source-built core and EST_NETSIM_PLUGIN inputs are required');
    const windows = target === 'win', suffix = windows ? '.dll' : '.so';
    const sourceLib = path.join(sdk, windows ? 'lib' : 'lib/x86_64-linux-gnu');
    const sourcePlugins = path.join(sourceLib, 'gstreamer-1.0');
    const plugins = ['coreelements','app','audioconvert','audioresample','audiobuffersplit','adder','volume','rawparse','wavenc','wavparse','webrtc','opus','nice','dtls','srtp','rtp','rtpmanager','udp',windows ? 'wasapi2' : 'alsa'];
    const pluginFiles = plugins.map(name => path.join(sourcePlugins, 'libgst' + name + suffix));
    const scanner = path.join(sdk, 'libexec/gstreamer-1.0/gst-plugin-scanner' + (windows ? '.exe' : ''));
    for (const file of [executable, netsimPlugin, scanner, ...pluginFiles]) await fs.access(file);
    await fs.mkdir(path.dirname(path.resolve(destination)), {recursive: true});
    const temporary = await fs.mkdtemp(path.resolve(destination) + '.tmp-');
    try {
        const runtime = path.join(temporary, 'gst-lib', windows ? 'x86_64-windows' : 'x86_64-linux-gnu');
        const lib = path.join(runtime, 'lib');await fs.mkdir(path.join(lib, 'gstreamer-1.0'), {recursive: true});
        // Dereference library aliases so no link in the distribution points
        // back at an SDK on the build host. Exclude debug/static/dev files.
        for (const name of await fs.readdir(sourceLib)) if (/\.so(?:\.\d+)*$/.test(name) || (windows && /\.dll$/i.test(name))) await fs.copyFile(path.join(sourceLib, name), path.join(lib, name));
        if (windows) {
            await fs.mkdir(path.join(runtime, 'bin'));
            for (const name of await fs.readdir(path.join(sdk, 'bin'))) if (/\.dll$/i.test(name)) await fs.copyFile(path.join(sdk, 'bin', name), path.join(runtime, 'bin', name));
        }
        for (const file of pluginFiles) await fs.copyFile(file, path.join(lib, 'gstreamer-1.0', path.basename(file)));
        await fs.copyFile(netsimPlugin, path.join(lib, 'gstreamer-1.0', 'libestnetsim' + suffix));
        const scannerTarget = path.join(runtime, 'libexec/gstreamer-1.0', path.basename(scanner));
        await fs.mkdir(path.dirname(scannerTarget), {recursive: true});await fs.copyFile(scanner, scannerTarget);await fs.chmod(scannerTarget, 0o755);
        const core = path.join(temporary, 'est-core' + (windows ? '.exe' : ''));await fs.copyFile(executable, core);await fs.chmod(core, 0o755);
        const provenance = {target, coreSha256: createHash('sha256').update(await fs.readFile(core)).digest('hex'), netsimSha256: createHash('sha256').update(await fs.readFile(netsimPlugin)).digest('hex')};
        await fs.writeFile(path.join(temporary, 'build-inputs.json'), JSON.stringify(provenance, null, 2) + '\n');
        const licenses = path.join(sdk, 'share/licenses');
        try {await fs.cp(licenses, path.join(runtime, 'licenses'), {recursive: true, dereference: true});} catch (error) {if (error.code !== 'ENOENT') throw error;}
        await fs.rename(temporary, destination);
        return destination;
    } catch (error) {await fs.rm(temporary, {recursive: true, force: true});throw error;}
}
if (require.main === module) void stageRuntime({target:process.env.TARGET_OS || 'linux',sdk:process.env.SDK,executable:process.env.EST_CORE_EXECUTABLE,netsimPlugin:process.env.EST_NETSIM_PLUGIN,destination:process.argv[2]}).then(value=>console.log('Staged runtime: '+value)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = {stageRuntime};
