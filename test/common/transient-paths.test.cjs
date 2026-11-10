const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {spawn}=require('node:child_process');
const {once}=require('node:events');

function policy() {
    assert.ok(fs.existsSync(path.join(__dirname, '../../common/transient-paths.cjs')), 'transient path policy must exist');
    return require('../../common/transient-paths.cjs');
}
function fixture(t) {
    fs.mkdirSync('/tmp/effectstreamer', {recursive:true, mode:0o700});
    const root = fs.mkdtempSync('/tmp/effectstreamer/path-test-');
    t.after(() => fs.rmSync(root, {recursive:true, force:true}));
    return root;
}
test('checkout outputs are absolute and Bash agrees for paths containing spaces and Unicode', t => {
    const anchor = fixture(t), nested = path.join(anchor, 'a space ü'); fs.mkdirSync(nested);
    const {createTransientPaths} = policy();
    const paths = createTransientPaths({anchor:nested});
    const hash = createHash('sha256').update(fs.realpathSync(nested)).digest('hex').slice(0,16);
    assert.equal(paths.base, `/tmp/effectstreamer/uid-${process.getuid()}/${hash}`);
    const expected = paths.base + '/est-core/build/linux/est-core';
    assert.equal(paths.path('est-core','build','linux','est-core'), expected);
    const script = path.resolve(__dirname, '../../common/transient-paths.sh');
    const result = spawnSync('bash',['-c','source "$1"; est_transient_path "$2" est-core build linux est-core','bash',script,nested], {cwd:'/',encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), expected);
    assert.notEqual(createTransientPaths({anchor}).base, paths.base);
    assert.notEqual(createTransientPaths({anchor:nested,userId:12345}).base, paths.base);
});
test('native Windows paths use system temp and a private username identity', t => {
    const {createTransientPaths} = policy();
    const value = createTransientPaths({anchor:fixture(t),platform:'win32',systemTemp:'C:\\Temp',userId:'Researcher'});
    assert.equal(value.root, 'C:\\Temp\\effectstreamer');
    assert.match(value.base, /^C:\\Temp\\effectstreamer\\user-[a-f0-9]{16}\\[a-f0-9]{16}$/);
});
test('directories are private, unique, confined, and recreated after owned cleanup', t => {
    const paths = policy().createTransientPaths({anchor:fixture(t)});
    t.after(() => fs.rmSync(paths.base,{recursive:true,force:true}));
    const a=paths.temporaryDirectory('common','fixture-'), b=paths.temporaryDirectory('common','fixture-');
    assert.notEqual(a,b); assert.equal(fs.statSync(a).mode & 0o777,0o700);
    assert.throws(() => paths.path('common','..'), /segment|unsafe/i);
    assert.throws(() => paths.path('common','/outside'), /segment|unsafe/i);
    assert.throws(() => paths.assertManagedOutput('/outside/result'), /managed|outside/i);
    assert.equal(paths.assertManagedOutput(path.join(a,'output')),path.join(a,'output'));
    fs.rmSync(paths.base,{recursive:true});
    assert.ok(fs.statSync(paths.directory('common','cache')).isDirectory());
});
test('output and directory writes reject symlinks and writable namespaces', t => {
    const anchor=fixture(t), paths=policy().createTransientPaths({anchor});
    t.after(()=>fs.rmSync(paths.base,{recursive:true,force:true}));
    const base=paths.directory('common');
    fs.symlinkSync(anchor,path.join(base,'escape'));
    assert.throws(()=>paths.directory('common','escape','write'),/symlink|unsafe/i);
    assert.throws(()=>paths.assertManagedOutput(path.join(base,'escape','write')),/symlink|unsafe/i);
    const writable=paths.directory('common','writable');fs.chmodSync(writable,0o777);
    assert.throws(()=>paths.directory('common','writable','child'),/unsafe|permission/i);
});
test('tool environment is isolated without changing SDK settings or its input', t => {
    const paths=policy().createTransientPaths({anchor:fixture(t)});
    t.after(()=>fs.rmSync(paths.base,{recursive:true,force:true}));
    const original={PATH:'/bin',LD_LIBRARY_PATH:'/sdk',TMPDIR:'/unrelated'};
    const env=paths.environment('common',original);
    assert.equal(original.TMPDIR,'/unrelated');assert.equal(env.LD_LIBRARY_PATH,'/sdk');
    for(const name of ['TMPDIR','TMP','TEMP','XDG_CACHE_HOME','NODE_COMPILE_CACHE']) {
        assert.ok(env[name].startsWith(paths.base + path.sep),name);
        assert.ok(fs.statSync(env[name]).isDirectory(),name);
    }
    assert.equal(paths.environment('common',env).EST_TRANSIENT_RUN_DIR,env.EST_TRANSIENT_RUN_DIR);
});
test('stable build locks fail clearly until their owner releases them', t => {
    const paths=policy().createTransientPaths({anchor:fixture(t)});
    t.after(()=>fs.rmSync(paths.base,{recursive:true,force:true}));
    const release=paths.acquireLock('est-core','linux');
    assert.throws(()=>paths.acquireLock('est-core','linux'),/lock.*exists|locked/i);
    release(); const next=paths.acquireLock('est-core','linux');next();
});
test('process locks reject conflicting instances and recover after an owner dies',async t=>{
    const anchor=fixture(t),paths=policy().createTransientPaths({anchor});t.after(()=>fs.rmSync(paths.base,{recursive:true,force:true}));
    assert.equal(typeof paths.acquireProcessLock,'function','process-lifetime coordination must exist');
    const source=path.resolve(__dirname,'../../common/transient-paths.cjs');
    const child=spawn(process.execPath,['-e',`const {createTransientPaths}=require(${JSON.stringify(source)});createTransientPaths({anchor:process.argv[1]}).acquireProcessLock('common','profile');console.log('ready');setInterval(()=>{},10000);`,anchor],{stdio:['ignore','pipe','pipe']});
    t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
    await once(child.stdout,'data');
    assert.throws(()=>paths.acquireProcessLock('common','profile'),/lock|instance/i);
    const exited=once(child,'close');child.kill('SIGKILL');await exited;
    const release=paths.acquireProcessLock('common','profile');release();
    paths.acquireProcessLock('common','profile')();
});
