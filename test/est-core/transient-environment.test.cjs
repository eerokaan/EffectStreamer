const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {checkoutPaths,createTransientPaths}=require('../../common/transient-paths.cjs');
test('standalone C startup sets managed scratch and registry paths without a Node host',t=>{
    const source=path.resolve(__dirname,'../../est-core/est-src/transient.c');assert.ok(fs.existsSync(source),'native transient initializer must exist');
    const flags=spawnSync('pkg-config',['--cflags','--libs','glib-2.0'],{encoding:'utf8'});
    if(flags.status!==0){t.skip('host GLib development files unavailable');return;}
    const root=checkoutPaths().temporaryDirectory('est-core','native-paths-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const executable=path.join(root,'fixture');
    const bin=path.join(root,'bin'),capture=path.join(root,'compiler-tmp');fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin,'gcc'),'#!/bin/sh\nprintf "%s" "$TMPDIR" > '+JSON.stringify(capture)+'\nexec /usr/bin/gcc "$@"\n',{mode:0o700});
    const old=process.env.PATH;process.env.PATH=bin+':'+old;let compiled;
    try {compiled=spawnSync('gcc',['-Wall','-Wextra','-Werror','-I'+path.dirname(source),source,path.join(__dirname,'fixtures/transient-environment.c'),...flags.stdout.trim().split(/\s+/),'-o',executable],{encoding:'utf8',env:checkoutPaths().environment('est-core')});}
    finally {process.env.PATH=old;}
    assert.equal(compiled.status,0,compiled.stderr);
    assert.ok(fs.readFileSync(capture,'utf8').startsWith(checkoutPaths().base+'/est-core/runs/'),'native-test compiler scratch must be managed');
    const inherited=path.join(root,'inherited.bin'),probe=spawnSync('gst-inspect-1.0',['--version']);
    const result=spawnSync(executable,probe.status===0?['gst-inspect-1.0','coreelements']:[],{cwd:'/',env:{...process.env,TMPDIR:'/outside',GST_REGISTRY:'/outside/registry',GST_REGISTRY_1_0:inherited},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout.split('\n')[0]),base=createTransientPaths({anchor:root}).base;
    assert.ok(value.tmp.startsWith(base+'/est-core/runs/'));assert.equal(value.cache,base+'/est-core/cache');assert.equal(value.registry,base+'/est-core/cache/gstreamer/registry-linux.bin');
    assert.equal(fs.existsSync(inherited),false,'the versioned registry variable must not bypass the managed cache');
    if(probe.status===0)assert.ok(fs.existsSync(value.registry));
    t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
});
