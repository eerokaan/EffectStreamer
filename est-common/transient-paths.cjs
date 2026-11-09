const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
function segment(value) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[/\\\0\r\n]/.test(value)) throw new Error('Unsafe transient path segment');
    return value;
}
function canonicalAnchor(value) {
    const absolute=path.resolve(value);
    try {return fs.realpathSync(absolute);} catch(error) {
        if(error.code!=='ENOENT')throw error;
        const parent=path.dirname(absolute);
        if(parent===absolute)throw error;
        return path.join(canonicalAnchor(parent),path.basename(absolute));
    }
}
function createTransientPaths({anchor, platform = process.platform, systemTemp, userId} = {}) {
    const windows = platform === 'win32', p = windows ? path.win32 : path.posix;
    const root = windows ? (systemTemp === undefined && process.env.EST_TRANSIENT_ROOT || p.join(systemTemp ?? os.tmpdir(), 'effectstreamer')) : '/tmp/effectstreamer';
    const identity = userId ?? (windows ? os.userInfo().username : process.getuid());
    const user = windows ? 'user-' + digest(String(identity)) : 'uid-' + identity;
    const base = p.join(root, user, digest(canonicalAnchor(anchor)));
    const inside = value => value.startsWith(base + p.sep);
    function check(directory, shared = false) {
        const stat = fs.lstatSync(directory);
        const sharedRoot = shared && stat.uid === 0 && (stat.mode & 0o1000);
        if (stat.isSymbolicLink() || !stat.isDirectory() || (!windows && !sharedRoot && (stat.uid !== process.getuid() || (stat.mode & 0o022)))) {
            throw new Error('Unsafe transient directory ownership, permissions, or symlink: ' + directory);
        }
    }
    function ensure(directory) {
        if (directory !== base && !inside(directory)) throw new Error('Output is outside the private managed transient namespace: ' + directory);
        let current = root;
        for (const part of ['', ...p.relative(root, directory).split(p.sep)]) {
            if (part) current = p.join(current, part);
            try { fs.mkdirSync(current, {mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
            check(current, current === root);
        }
        return directory;
    }
    function output(value) {
        const resolved = p.resolve(value);
        if (!inside(resolved)) throw new Error('Output must be inside the private managed transient namespace: ' + base);
        let current = root;
        for (const part of ['', ...p.relative(root, resolved).split(p.sep)]) {
            if (part) current = p.join(current, part);
            let stat; try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            if (stat.isSymbolicLink()) throw new Error('Unsafe transient output symlink: ' + current);
            if (current !== resolved || stat.isDirectory()) check(current, current === root);
        }
        return resolved;
    }
    const paths = {
        root, base,
        path(component, ...parts) { return p.join(base, ...[component,...parts].map(segment)); },
        directory(component, ...parts) { return ensure(paths.path(component,...parts)); },
        assertManagedOutput:output,
        temporaryDirectory(component, prefix) {
            const directory=fs.mkdtempSync(p.join(paths.directory(component,'runs'),segment(prefix)));
            fs.chmodSync(directory,0o700); return directory;
        },
        environment(component, env = process.env, runDirectory) {
            let run=runDirectory || env.EST_TRANSIENT_RUN_DIR;
            if (!run || !inside(p.resolve(run))) {
                if (runDirectory) throw new Error('Run directory is outside the managed namespace');
                run=paths.temporaryDirectory(component,'run-');
            }
            run=ensure(output(run));
            const temporary=ensure(p.join(run,'tmp'));
            const browserCache=process.platform==='win32' ? path.join(env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'ms-playwright') :
                process.platform==='darwin' ? path.join(os.homedir(),'Library','Caches','ms-playwright') : path.join(env.XDG_CACHE_HOME || path.join(os.homedir(),'.cache'),'ms-playwright');
            return {...env,EST_TRANSIENT_ROOT:root,EST_TRANSIENT_RUN_DIR:run,TMPDIR:temporary,TMP:temporary,TEMP:temporary,
                PLAYWRIGHT_BROWSERS_PATH:env.PLAYWRIGHT_BROWSERS_PATH || browserCache,
                XDG_CACHE_HOME:paths.directory(component,'cache'),NODE_COMPILE_CACHE:paths.directory(component,'cache','node')};
        },
        acquireLock(component, name) {
            const lock=p.join(paths.directory(component,'locks'),segment(name) + '.lock');
            try { fs.mkdirSync(lock,{mode:0o700}); } catch (error) {
                if (error.code === 'EEXIST') throw new Error('Build lock exists: ' + lock + '; stop the owner or remove this stale lock after confirming it is inactive');
                throw error;
            }
            let owned=true;
            return () => { if (owned) { fs.rmdirSync(lock); owned=false; } };
        },
        acquireProcessLock(component,name) {
            const lock=p.join(paths.directory(component,'locks'),segment(name)+'.process-lock');
            for(let attempt=0;attempt<2;attempt++) {
                try {
                    fs.mkdirSync(lock,{mode:0o700});
                    const owner=p.join(lock,String(process.pid));fs.mkdirSync(owner,{mode:0o700});
                    let owned=true;
                    const release=()=>{
                        if(!owned)return;owned=false;process.off('exit',release);
                        fs.rmdirSync(owner);fs.rmdirSync(lock);
                    };
                    process.once('exit',release);return release;
                } catch(error) {
                    if(error.code!=='EEXIST')throw error;
                    check(lock);
                    const owners=fs.readdirSync(lock);
                    if(attempt || owners.length!==1 || !/^[1-9]\d*$/.test(owners[0]))throw new Error('Another instance holds the state lock: '+lock);
                    const pid=Number(owners[0]);let alive=true;
                    try {process.kill(pid,0);} catch(probe) {if(probe.code==='ESRCH')alive=false;else if(probe.code!=='EPERM')throw probe;}
                    if(alive)throw new Error('Another instance holds the state lock: '+lock);
                    const owner=p.join(lock,owners[0]);check(owner);
                    fs.rmdirSync(owner);fs.rmdirSync(lock);
                }
            }
            throw new Error('Could not acquire state lock: '+lock);
        }
    };
    return paths;
}
function checkoutPaths() { return createTransientPaths({anchor:path.resolve(__dirname,'..')}); }
if (require.main === module) {
    try {
        const [command,component,...parts]=process.argv.slice(2);
        if (command !== 'path') throw new Error('Usage: transient-paths.cjs path COMPONENT SEGMENTS...');
        console.log(checkoutPaths().path(component,...parts));
    } catch (error) { console.error(error.message); process.exitCode=1; }
}
module.exports={createTransientPaths,checkoutPaths};
