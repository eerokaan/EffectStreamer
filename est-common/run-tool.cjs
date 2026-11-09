const {spawn} = require('node:child_process');
const os = require('node:os');
const path=require('node:path');
const {checkoutPaths} = require('./transient-paths.cjs');

function runTool(component, executable, args, {cwd, env: input = process.env} = {}) {
    const paths=checkoutPaths(),env=paths.environment(component,input);
    if(executable==='eslint') {
        const metadata=require.resolve('eslint/package.json',{paths:[cwd || process.cwd()]});
        args=[path.join(path.dirname(metadata),'bin/eslint.js'),'--cache-location',paths.path(component,'cache','eslint'),...args];executable=process.execPath;
    }
    return new Promise((resolve,reject)=>{
        let child;
        const previous=process.umask(0o077);
        try {child=spawn(executable === 'node' ? process.execPath : executable,args,{cwd,env,stdio:'inherit'});}
        finally {process.umask(previous);}
        const forward=signal=>()=>child.kill(signal);
        const handlers=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,forward(signal)]));
        for(const [signal,handler] of handlers) process.on(signal,handler);
        const cleanup=()=>{for(const [signal,handler] of handlers) process.off(signal,handler);};
        child.once('error',error=>{cleanup();reject(error);});
        child.once('close',(code,signal)=>{cleanup();resolve(code ?? 128 + (os.constants.signals[signal] || 1));});
    });
}
if(require.main === module) {
    const [component,executable,...args]=process.argv.slice(2);
    if(!component || !executable) {console.error('Usage: run-tool.cjs COMPONENT EXECUTABLE ARGS...');process.exitCode=1;}
    else runTool(component,executable,args).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={runTool};
