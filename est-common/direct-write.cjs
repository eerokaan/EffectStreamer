const fs = require('node:fs');
const path=require('node:path');
const pending=new Map();
const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
function regular(stat) {
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Direct-save destination must be a regular, non-symlink, non-hardlinked file');
}
function destinationKey(destination) {
    return path.join(fs.realpathSync(path.dirname(path.resolve(destination))),path.basename(destination));
}
async function performWrite(destination, contents, {mode = 0o600, flush = false} = {}) {
    try { regular(await fs.promises.lstat(destination)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const file = await fs.promises.open(destination, flags, mode);
    try {
        regular(await file.stat()); await file.chmod(mode); await file.truncate(0);
        await file.writeFile(contents);
        if (flush) await file.sync();
    } finally { await file.close(); }
}
async function writeFileDirect(destination, contents, options = {}) {
    const key=destinationKey(destination),previous=pending.get(key) || Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>performWrite(destination,contents,options));
    pending.set(key,next);
    try {await next;} finally {if(pending.get(key)===next)pending.delete(key);}
}
function writeFileDirectSync(destination, contents, {mode = 0o600, flush = false} = {}) {
    if(pending.has(destinationKey(destination)))throw new Error('A direct save is in progress for this destination');
    try { regular(fs.lstatSync(destination)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const file=fs.openSync(destination,flags,mode);
    try {
        regular(fs.fstatSync(file));fs.fchmodSync(file,mode);fs.ftruncateSync(file,0);
        fs.writeFileSync(file,contents);
        if(flush)fs.fsyncSync(file);
    } finally {fs.closeSync(file);}
}
module.exports={writeFileDirect,writeFileDirectSync};
