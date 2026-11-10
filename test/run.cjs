const fs=require('node:fs');
const path=require('node:path');
const {testEnvironment}=require('./environment.cjs');
const {runTool}=require('../common/run-tool.cjs');
const root=path.resolve(__dirname,'..');

function validateNodeArguments(args) {
    const flags=['--test-only','--test-force-exit','--watch','--help','-h'];
    const values=['--test-name-pattern','--test-skip-pattern','--test-concurrency','--test-timeout'];
    for(let i=0;i<args.length;i++) {
        const arg=args[i];if(flags.includes(arg))continue;
        const index=arg.indexOf('='),name=index<0?arg:arg.slice(0,index);
        if(values.includes(name)) {
            const value=index<0?args[++i]:arg.slice(index+1);
            if(value && !value.startsWith('-'))continue;
        }
        throw new Error('Unsupported test argument: '+arg+'; output/configuration overrides are managed by EffectStreamer');
    }
}
function validateGuiArguments(command,args) {
    const unit=command==='est-gui';
    const flags=unit?['--run','--watch','--silent','--coverage','--passWithNoTests','--help','-h']:['--list','--headed','--debug','--help','-h'];
    const values=unit?['--exclude','--testNamePattern','-t','--maxWorkers','--pool','--configLoader']:['--grep','--grep-invert','--project','--workers','--repeat-each','--timeout','--retries'];
    for(let i=0;i<args.length;i++) {
        const arg=args[i];
        if(!arg.startsWith('-') || flags.includes(arg))continue;
        const index=arg.indexOf('='),name=index<0?arg:arg.slice(0,index);
        if(values.includes(name)) {
            const value=index<0?args[++i]:arg.slice(index+1);
            if(value && !value.startsWith('-') && (name!=='--configLoader' || value==='runner'))continue;
        }
        throw new Error('Unsupported '+command+' argument: '+arg+'; output/configuration overrides are managed by EffectStreamer');
    }
}
function bin(name,key=name) {
    const metadata=require.resolve(name+'/package.json'),pkg=require(metadata);
    return path.resolve(path.dirname(metadata),typeof pkg.bin==='string'?pkg.bin:pkg.bin[key]);
}
async function runTests(command,args=[],{spawnTool}={}) {
    const gui=['est-gui','e2e','audio-tests'].includes(command),component=gui?'est-gui':command;
    if(!gui && !['common','est-core','est-server'].includes(command))throw new Error('Unknown test command: '+command);
    if(gui)validateGuiArguments(command,args);else validateNodeArguments(args);
    const env=testEnvironment(component);
    const spawn=spawnTool || ((executable,argv,options)=>runTool(component,executable,argv,options));
    if(gui) {
        env.PLAYWRIGHT_HTML_OUTPUT_DIR=path.join(env.EST_TRANSIENT_RUN_DIR,'playwright-report');
        const config=path.join(__dirname,'est-gui',command==='est-gui'?'vitest.config.mjs':command==='e2e'?'playwright.config.mjs':'playwright.audio.config.mjs');
        const argv=command==='est-gui'?[bin('vitest'),'--config',config,'--configLoader','runner',...args]:[bin('@playwright/test','playwright'),'test','--config',config,...args];
        return await spawn(process.execPath,argv,{cwd:path.join(root,component),env});
    }
    const files=fs.readdirSync(path.join(__dirname,command)).filter(name=>/\.test\.(?:cjs|js)$/.test(name)).sort().map(name=>path.join(__dirname,command,name));
    return await spawn(process.execPath,['--test',...args,...files],{cwd:path.join(root,command),env});
}
if(require.main===module)runTests(process.argv[2],process.argv.slice(3)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={runTests};
