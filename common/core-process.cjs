const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const {StringDecoder} = require('node:string_decoder');
const {randomUUID} = require('node:crypto');
const {coreEnvironment}=require('./core-environment.cjs');

async function startCore({executable,args=[],env=process.env,timeoutMs=10000}) {
    const child=spawn(executable,args,{env:coreEnvironment({executable,env}),stdio:['pipe','pipe','pipe']});
    const events=new EventEmitter();
    const pending=new Map();
    const decoder=new StringDecoder('utf8');
    let buffer='',stderr='',ready=false,closed=false,stopping=false,stopPromise;
    let resolveReady,rejectReady,resolveExit;
    const readiness=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    const exited=new Promise(resolve=>{resolveExit=resolve;});
    function fail(error) {
        rejectReady(error);
        for(const {reject,timer} of pending.values()) {clearTimeout(timer);reject(error);}
        pending.clear();
        events.emit('media-failed',error);
        if(!closed) child.kill('SIGKILL');
    }
    const timer=setTimeout(()=>fail(new Error('Timed out waiting for core readiness')),timeoutMs);
    function line(text) {
        let message;
        try {message=JSON.parse(text);} catch {throw new Error('Invalid core NDJSON JSON');}
        if(!message || message.version!==1) throw new Error('Invalid core NDJSON version');
        if(message.type==='event' && typeof message.event==='string') {
            if(message.event==='control-ready' && !ready) {ready=true;clearTimeout(timer);resolveReady();}
            events.emit(message.event,message.payload);
        } else if(message.type==='response' && typeof message.ok==='boolean') {
            const request=pending.get(message.id);
            if(!request) {if(message.id===null && !message.ok) events.emit('protocol-error',message.error);return;}
            clearTimeout(request.timer);pending.delete(message.id);
            message.ok?request.resolve(message.payload):request.reject(new Error(message.error?.message || 'Core request failed'));
        } else throw new Error('Invalid core NDJSON message');
    }
    child.stdout.on('data',chunk=>{
        try {
            buffer+=decoder.write(chunk);
            let end;
            while((end=buffer.indexOf('\n'))!==-1) {
                if(Buffer.byteLength(buffer.slice(0,end))>1048576) throw new Error('Core NDJSON line limit exceeded');
                const text=buffer.slice(0,end);buffer=buffer.slice(end+1);line(text);
            }
            if(Buffer.byteLength(buffer)>1048576) throw new Error('Core NDJSON line limit exceeded');
        } catch(error) {fail(error);}
    });
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-32768);events.emit('log',chunk.toString());});
    child.stdin.on('error',error=>{if(!stopping) fail(error);});
    child.stdout.on('error',fail);child.stderr.on('error',fail);child.once('error',fail);
    child.once('close',(code,signal)=>{
        closed=true;clearTimeout(timer);
        const error=new Error(`Core exited ${ready?'unexpectedly':'before readiness'} (${code ?? signal}): ${stderr}`);
        rejectReady(error);
        for(const request of pending.values()) {clearTimeout(request.timer);request.reject(error);}pending.clear();
        resolveExit({code,signal});
        if(ready&&!stopping) events.emit('exit',{code,signal});
    });
    const handle={child,exited,
        on(event,listener) {events.on(event,listener);return ()=>events.off(event,listener);},
        request(command,payload={}) {
            if(closed || child.stdin.writableEnded) return Promise.reject(new Error('Core is closed'));
            const id=randomUUID();
            return new Promise((resolve,reject)=>{
                const requestTimer=setTimeout(()=>{pending.delete(id);reject(new Error('Timed out waiting for '+command));},timeoutMs);
                pending.set(id,{resolve,reject,timer:requestTimer});
                child.stdin.write(JSON.stringify({version:1,type:'request',id,command,payload})+'\n');
            });
        },
        stop({timeoutMs:stopTimeoutMs=5000}={}) {
            if(stopPromise) return stopPromise;
            stopping=true;
            stopPromise=(async()=>{
                if(closed) {
                    const result=await exited;
                    if(result.code!==0) throw new Error('Core stopped unsuccessfully: '+stderr);
                    return result;
                }
                // Reply to shutdown is advisory; process exit is the lifecycle boundary.
                void handle.request('shutdown',{}).catch(()=>{});
                let stopTimer;
                const timedOut=await Promise.race([exited.then(()=>false),new Promise(resolve=>{stopTimer=setTimeout(()=>resolve(true),stopTimeoutMs);})]);
                clearTimeout(stopTimer);
                if(timedOut) {child.kill('SIGKILL');await exited;throw new Error('Core graceful stop timed out: '+stderr);}
                const result=await exited;
                if(result.code!==0) throw new Error('Core stopped unsuccessfully: '+stderr);
                return result;
            })();
            return stopPromise;
        }
    };
    try {await readiness;return handle;} catch(error) {await exited;throw error;}
}
module.exports={startCore};
