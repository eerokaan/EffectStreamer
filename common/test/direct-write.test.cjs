const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkoutPaths}=require('../transient-paths.cjs');
function fixture(t) {const dir=checkoutPaths().temporaryDirectory('common','direct-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function writers() {assert.ok(fs.existsSync(path.join(__dirname,'../direct-write.cjs')),'direct-write helpers must exist');return require('../direct-write.cjs');}
test('writes only to its destination and restricts private replacement permissions',async t=>{
    const {writeFileDirect,writeFileDirectSync}=writers(),root=fixture(t),file=path.join(root,'data.json');
    fs.writeFileSync(file,'old',{mode:0o644});
    t.mock.method(fs.promises,'rename',()=>{throw new Error('rename forbidden');});
    t.mock.method(fs,'renameSync',()=>{throw new Error('rename forbidden');});
    const open=fs.promises.open.bind(fs.promises),paths=[];
    t.mock.method(fs.promises,'open',async(name,...args)=>{paths.push(name);return open(name,...args);});
    await writeFileDirect(file,'new',{flush:true});
    assert.deepEqual(paths,[file]);assert.equal(fs.readFileSync(file,'utf8'),'new');
    assert.equal(fs.statSync(file).mode & 0o777,0o600);
    writeFileDirectSync(file,'sync',{flush:true});assert.equal(fs.readFileSync(file,'utf8'),'sync');
    assert.deepEqual(fs.readdirSync(root),['data.json']);
});
test('symlink and non-regular destinations are rejected without changing other data',async t=>{
    const {writeFileDirect,writeFileDirectSync}=writers(),root=fixture(t),file=path.join(root,'target'),link=path.join(root,'link');
    fs.writeFileSync(file,'keep');fs.symlinkSync(file,link);
    await assert.rejects(writeFileDirect(link,'bad'),/symlink|symbolic|ELOOP/i);
    assert.throws(()=>writeFileDirectSync(link,'bad'),/symlink|symbolic|ELOOP/i);
    await assert.rejects(writeFileDirect(root,'bad'),/regular|directory|EISDIR/i);
    assert.equal(fs.readFileSync(file,'utf8'),'keep');
});
test('a failed direct save reports the error and leaves its partial destination',async t=>{
    const {writeFileDirect}=writers(),root=fixture(t),file=path.join(root,'data');
    fs.writeFileSync(file,'old complete data');
    const open=fs.promises.open.bind(fs.promises);
    t.mock.method(fs.promises,'open',async(...args)=>{
        const handle=await open(...args),write=handle.writeFile.bind(handle);
        handle.writeFile=async()=>{await write('partial');throw new Error('disk failure');};return handle;
    });
    await assert.rejects(writeFileDirect(file,'new complete data'),/disk failure/);
    assert.equal(fs.readFileSync(file,'utf8'),'partial');assert.deepEqual(fs.readdirSync(root),['data']);
});
test('overlapping direct saves are serialized before truncation and the last call wins',async t=>{
    const {writeFileDirect,writeFileDirectSync}=writers(),root=fixture(t),file=path.join(root,'data.json');
    const open=fs.promises.open.bind(fs.promises);let opens=0,started,release;
    const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    t.mock.method(fs.promises,'open',async(...args)=>{
        const handle=await open(...args);opens++;
        if(opens===1){const write=handle.writeFile.bind(handle);handle.writeFile=async contents=>{started();await gate;return write(contents);};}
        return handle;
    });
    const first=writeFileDirect(file,JSON.stringify({large:'x'.repeat(10000)}));await entered;
    const second=writeFileDirect(file,'{}');
    try {
        const premature=await Promise.race([second.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),200))]);
        assert.equal(premature,false,'a later save cannot finish before the first save is released');
        assert.equal(opens,1,'second writer must not truncate while the first save is running');
        assert.throws(()=>writeFileDirectSync(file,'bad'),/in progress|busy/i);
    } finally {release();await Promise.all([first,second]);}
    assert.equal(fs.readFileSync(file,'utf8'),'{}');
});
