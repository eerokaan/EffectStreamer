const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
test('tool launcher preserves arguments, exit status, and controlled scratch environment',()=>{
    const script=path.resolve(__dirname,'../run-tool.cjs');
    assert.ok(fs.existsSync(script),'managed tool launcher must exist');
    const result=spawnSync(process.execPath,[script,'common','node','-e',
        'console.log(JSON.stringify({arg:process.argv[1],tmp:process.env.TMPDIR,cache:process.env.XDG_CACHE_HOME}));process.exit(7);','a space ü'],{cwd:'/',encoding:'utf8'});
    assert.equal(result.status,7,result.stderr);
    const value=JSON.parse(result.stdout);assert.equal(value.arg,'a space ü');
    assert.match(value.tmp,/^\/tmp\/effectstreamer\/uid-\d+\/[a-f0-9]{16}\/common\/runs\//);
    assert.match(value.cache,/\/common\/cache$/);
});
test('managed lint launches the installed Node CLI even without a shell tool PATH',()=>{
    const script=path.resolve(__dirname,'../run-tool.cjs');
    const result=spawnSync(process.execPath,[script,'est-server','eslint','--version'],{cwd:path.resolve(__dirname,'../../est-server'),env:{...process.env,PATH:'/no-tools'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/^v\d+\./);
});
test('tool-created output directories are private even when the calling shell has a shared umask',()=>{
    const script=path.resolve(__dirname,'../run-tool.cjs'),old=process.umask(0o002);let result;
    try {result=spawnSync(process.execPath,[script,'common','node','-e',`const fs=require('fs'),path=require('path'),dir=path.join(process.env.TMPDIR,'child-output');fs.mkdirSync(dir);console.log(fs.statSync(dir).mode&511);`],{encoding:'utf8'});}
    finally {process.umask(old);}
    assert.equal(result.status,0,result.stderr);assert.equal(Number(result.stdout.trim()),0o700);
});
