// Loopback-only, single-peer signaling reference. Not a study coordinator.
const http = require('node:http');
const path = require('node:path');
const {startCore} = require('../../est-common/core-process.cjs');
const {coreEnvironment} = require('../../est-common/core-environment.cjs');

async function createWebRtcHost({executable, args, env = process.env}) {
    const role = args[args.indexOf('--mode') + 1];
    if (!['sender', 'receiver'].includes(role)) throw new Error('Select --mode sender or receiver');
    const core = await startCore({executable, args, env: coreEnvironment({executable, env})});
    const streams = new Set(), history = [];
    core.on('ice-candidate', candidate => {
        history.push(candidate);
        for (const response of streams) response.write('data: ' + JSON.stringify(candidate) + '\n\n');
    });
    const server = http.createServer(async (request, response) => {
        // No cross-origin signaling or public binding: this example has no
        // participant authentication, unlike the production coordinator.
        if (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host) {response.writeHead(403);response.end();return;}
        if (request.method === 'GET' && request.url === '/') {response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page(role));return;}
        if (request.method === 'GET' && request.url === '/events') {
            response.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store'});response.write(': connected\n\n');streams.add(response);
            for (const value of history) response.write('data: ' + JSON.stringify(value) + '\n\n');
            request.once('close', () => streams.delete(response));return;
        }
        response.setHeader('Content-Type', 'application/json');
        if (request.method !== 'POST' || !['/signal', '/start'].includes(request.url)) {response.writeHead(404);response.end('{}');return;}
        try {
            let bytes = 0, text = '';
            for await (const chunk of request) {bytes += chunk.length;if (bytes > 262144) throw new Error('Signaling payload too large');text += chunk;}
            const value = JSON.parse(text || '{}');
            let result;
            if (request.url === '/start') result = await core.request('audio.start', {});
            else if (value.type === 'offer' && typeof value.sdp === 'string') result = await core.request('webrtc.offer', {type:'offer',sdp:value.sdp});
            else if (value.type === 'ice' && (value.candidate === null || typeof value.candidate === 'string')) result = await core.request('webrtc.ice', {candidate:value.candidate,sdpMLineIndex:value.sdpMLineIndex});
            else throw new Error('Expected an offer or ICE candidate');
            response.end(JSON.stringify(result || {}));
        } catch (error) {response.writeHead(400);response.end(JSON.stringify({error:error.message}));}
    });
    return {server, core, listen: port => new Promise(resolve => server.listen(port,'127.0.0.1',resolve)), async close() {
        for (const response of streams) response.end();server.closeAllConnections();
        await Promise.all([core.stop({timeoutMs:7000}),new Promise(resolve=>server.close(resolve))]);
    }};
}
function page(role) {
    return `<!doctype html><meta charset="utf-8"><title>Standalone est-core peer</title>
<button id="connect">Connect ${role} peer</button><audio id="playback" controls></audio><pre id="status"></pre>
<script>
const post=async(route,value)=>{const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const answer=await response.json();if(!response.ok)throw new Error(answer.error);return answer;};
document.getElementById('connect').onclick=async()=>{try{
const peer=new RTCPeerConnection(),pending=[];
const events=new EventSource('/events');events.onmessage=async event=>{const value=JSON.parse(event.data),candidate=value.candidate===null?null:value;if(peer.remoteDescription)await peer.addIceCandidate(candidate);else pending.push(candidate);};
peer.onicecandidate=event=>post('/signal',{type:'ice',candidate:event.candidate?.candidate||null,sdpMLineIndex:event.candidate?.sdpMLineIndex||0});
${role === 'sender' ? "const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});peer.addTransceiver(stream.getAudioTracks()[0],{direction:'sendonly',streams:[stream]});" : "peer.addTransceiver('audio',{direction:'recvonly'});peer.ontrack=async event=>{const audio=document.getElementById('playback');audio.srcObject=event.streams[0]||new MediaStream([event.track]);await audio.play();};"}
await peer.setLocalDescription(await peer.createOffer());await peer.setRemoteDescription(await post('/signal',{type:'offer',sdp:peer.localDescription.sdp}));for(const candidate of pending)await peer.addIceCandidate(candidate);
peer.onconnectionstatechange=()=>{document.getElementById('status').textContent=peer.connectionState;if(peer.connectionState==='connected')post('/start',{});};
}catch(error){document.getElementById('status').textContent=error.message;}};
</script>`;
}
if (require.main === module) {
    const [executable, ...args] = process.argv.slice(2);
    if (!executable) {console.error('Usage: node webrtc-host.cjs /path/to/est-core --mode sender|receiver --device-type webrtc --control ndjson --recording none ...');process.exitCode=1;}
    else void createWebRtcHost({executable:path.resolve(executable),args}).then(async host => {
        await host.listen(Number(process.env.PORT || 8080));console.log('Single peer: http://127.0.0.1:' + host.server.address().port);
        for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void host.close().then(()=>process.exit(0));});
    }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports = {createWebRtcHost};
