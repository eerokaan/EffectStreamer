const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {writeFileDirectSync}=require('../../common/direct-write.cjs');
const {runTool}=require('../../common/run-tool.cjs');
const project=path.resolve(__dirname,'..');
function bin(name,key=name) {
    const metadata=require.resolve(name+'/package.json'),pkg=require(metadata);
    return path.resolve(path.dirname(metadata),typeof pkg.bin==='string'?pkg.bin:pkg.bin[key]);
}
function application(paths) {
    const app=paths.directory('est-gui','app'),modules=path.join(app,'node_modules'),source=path.join(project,'node_modules');
    try {
        if(!fs.lstatSync(modules).isSymbolicLink() || fs.realpathSync(modules)!==fs.realpathSync(source))throw new Error('Unexpected temporary application dependencies: '+modules);
    } catch(error) {if(error.code==='ENOENT')fs.symlinkSync(source,modules,process.platform==='win32'?'junction':'dir');else throw error;}
    writeFileDirectSync(path.join(app,'package.json'),JSON.stringify({...require('../package.json'),main:'out/main/index.js'},null,2)+'\n');
    return app;
}
function validateArguments(command,args) {
    const flags={
        'web-build':['--watch','--sourcemap','--emptyOutDir','--help','-h'],
        'electron-build':['--watch','--sourcemap','--help','-h'],
        'electron-dev':['--rendererOnly','--help','-h'],
        'electron-preview':['--skipBuild','--help','-h'],
        package:['--dir','--help','-h'],
        test:['--run','--watch','--silent','--coverage','--passWithNoTests','--help','-h'],
        e2e:['--list','--headed','--debug','--help','-h'],
        'audio-tests':['--list','--headed','--debug','--help','-h'],
        lint:['--quiet','--no-fix','--help','-h']
    };
    const values={
        'web-build':['--mode','--logLevel'], 'electron-build':['--mode','--logLevel'],
        'electron-dev':['--mode','--logLevel','--host','--port'], 'electron-preview':['--mode','--logLevel'],
        package:[],test:['--exclude','--testNamePattern','-t','--maxWorkers','--pool','--configLoader'],
        e2e:['--grep','--grep-invert','--project','--workers','--repeat-each','--timeout','--retries'],
        'audio-tests':['--grep','--grep-invert','--project','--workers','--repeat-each','--timeout','--retries'],lint:['--max-warnings']
    };
    for(let i=command==='package'?1:0;i<args.length;i++) {
        const argument=args[i];
        if(!argument.startsWith('-') && ['test','e2e','audio-tests','lint'].includes(command))continue;
        if(flags[command]?.includes(argument))continue;
        const index=argument.indexOf('='),name=index<0?argument:argument.slice(0,index);
        if(values[command]?.includes(name)) {
            const value=index<0?args[++i]:argument.slice(index+1);
            if(!value || value.startsWith('-') || name==='--configLoader' && value!=='runner')throw new Error('Unsupported '+command+' argument value: '+argument);
            continue;
        }
        throw new Error('Unsupported '+command+' argument: '+argument+'; output/configuration overrides are managed by EffectStreamer');
    }
}
async function runGui(command,args=[],{spawnTool=(executable,argv,options)=>runTool('est-gui',executable,argv,options)}={}) {
    validateArguments(command,args);
    const paths=checkoutPaths(),env=paths.environment('est-gui');
    env.ELECTRON_CACHE=paths.directory('est-gui','cache','electron');env.ELECTRON_BUILDER_CACHE=paths.directory('est-gui','cache','electron-builder');
    env.PLAYWRIGHT_HTML_OUTPUT_DIR=path.join(env.EST_TRANSIENT_RUN_DIR,'playwright-report');
    const spawn=(argv)=>spawnTool(process.execPath,argv,{cwd:project,env});
    const group=command.startsWith('electron-') || command==='package'?'electron':command==='web-build'?'web':null;
    const release=group?paths.acquireLock('est-gui',group):()=>{};
    let reservedOutput;
    const finish=code=>{if(code!==0 && reservedOutput)console.error('Build failed; incomplete distribution may remain at '+reservedOutput);return code;};
    try {
        if(command.startsWith('electron-') || command==='package') {
            const target=command==='package'?args[0]:null;
            if(target && !['linux','win'].includes(target))throw new Error('Package target must be linux or win');
            if(command==='package' && !target)throw new Error('Package target is required');
            const output=command==='package'?path.resolve(process.env.EST_DISTRIBUTION_DIR || path.join(project,'dist')):null;
            if(output) {
                fs.mkdirSync(path.dirname(output),{recursive:true});
                try{fs.mkdirSync(output,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('Refusing to overwrite existing distribution: '+output+'; choose a new EST_DISTRIBUTION_DIR');throw error;}
                reservedOutput=output;
            }
            const action=command==='package'?'build':{'electron-dev':'dev','electron-preview':'preview','electron-build':'build'}[command];
            if(!action)throw new Error('Unknown GUI command: '+command);
            const app=application(paths),work=paths.temporaryDirectory('est-gui','electron-config-'),proxy=path.join(work,'electron.config.cjs');
            for(const part of ['main','preload','renderer'])paths.directory('est-gui','app','out',part);
            const url=pathToFileURL(path.join(project,'electron.vite.config.mjs')).href;
            writeFileDirectSync(proxy,`const source=${JSON.stringify(url)};module.exports=async env=>{const config=(await import(source)).default;return typeof config==='function'?config(env):await config;};\n`);
            env.ELECTRON_ENTRY=app;env.EST_GUI_SOURCE_ROOT=project;
            const code=await spawn([bin('electron-vite'),action,'--config',proxy,...(action==='build'?[]:['--entry',app]),...(command==='package'?[]:args),...(action==='build'?[]:['--','--no-sandbox'])]);
            if(command!=='package' || code!==0)return finish(code);
            const config=path.join(work,'electron-builder.json');
            writeFileDirectSync(config,JSON.stringify({extends:path.join(project,'electron-builder.yml'),directories:{app,output,buildResources:path.join(project,'build')},
                files:['out/**/*','package.json'],extraResources:[{from:path.join(project,'public/audio'),to:'audio'}],afterPack:path.join(project,'build_scripts/afterPack.js'),npmRebuild:false,
                ...(target==='linux' && process.platform==='linux' || target==='win' && process.platform==='win32'?{electronDist:path.join(project,'node_modules/electron/dist')}:{})},null,2)+'\n');
            return finish(await spawn([bin('electron-builder','electron-builder'),'--'+target,'--projectDir',app,'--config',config,'--publish','never',...args.slice(1)]));
        }
        if(command==='web-build') {paths.directory('est-gui','web');return await spawn([bin('vite'),'build','--config',path.join(project,'vite.web.config.mjs'),'--configLoader','runner',...args]);}
        if(command==='test')return await spawn([bin('vitest'),'--config',path.join(project,'vitest.config.mjs'),'--configLoader','runner',...args]);
        if(command==='lint')return await spawn([bin('eslint'),'--cache','--cache-location',paths.path('est-gui','cache','eslint'),'--fix','.',...args]);
        if(command==='audio-tests' || command==='e2e')return await spawn([bin('@playwright/test','playwright'),'test','--config',path.join(project,command==='audio-tests'?'playwright.audio.config.mjs':'playwright.config.mjs'),...args]);
        throw new Error('Unknown GUI command: '+command);
    } catch(error) {if(reservedOutput)console.error('Build failed; incomplete distribution may remain at '+reservedOutput);throw error;}
    finally {release();}
}
if(require.main===module)runGui(process.argv[2],process.argv.slice(3)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={runGui};
