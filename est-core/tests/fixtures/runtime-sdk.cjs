const fs=require('node:fs');
const path=require('node:path');
function runtimeFixture(root,target='linux') {
    const win=target==='win',sdk=path.join(root,'sdk'),lib=path.join(sdk,win?'lib':'lib/x86_64-linux-gnu'),plugins=path.join(lib,'gstreamer-1.0');
    fs.mkdirSync(plugins,{recursive:true});
    const names=['coreelements','app','audioconvert','audioresample','audiobuffersplit','adder','volume','rawparse','wavenc','wavparse','webrtc','opus','nice','dtls','srtp','rtp','rtpmanager','udp',win?'wasapi2':'alsa'];
    for(const name of names)fs.writeFileSync(path.join(plugins,'libgst'+name+(win?'.dll':'.so')),name);
    fs.writeFileSync(path.join(lib,win?'runtime.dll':'libruntime.so.0'),'library');
    const scanner=path.join(sdk,'libexec/gstreamer-1.0/gst-plugin-scanner'+(win?'.exe':''));fs.mkdirSync(path.dirname(scanner),{recursive:true});fs.writeFileSync(scanner,'scanner');
    if(win){fs.mkdirSync(path.join(sdk,'bin'));fs.writeFileSync(path.join(sdk,'bin/runtime.dll'),'library');}
    const executable=path.join(root,'input-core'+(win?'.exe':'')),netsimPlugin=path.join(root,win?'libestnetsim.dll':'libestnetsim.so');
    fs.writeFileSync(executable,'source-built-core');fs.writeFileSync(netsimPlugin,'netsim');
    return {target,sdk,executable,netsimPlugin};
}
module.exports={runtimeFixture};
