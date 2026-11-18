import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
vi.mock('electron',()=>({app:{getPath:vi.fn()}}));
import {app} from 'electron';
import {readGuiConfig,saveAudioDeviceIds} from '../../est-gui/src/main/lib/config.js';
const require=createRequire(import.meta.url),{checkoutPaths}=require('../../common/transient-paths.cjs');

function currentConfig(backend='native') {
    return {server:{url:'http://127.0.0.1:3000'},audio:{backend,devices:{source:'input',sink:'output'}},client:{identity:'client-a',ipAddress:'127.0.0.1'}};
}

it.each(['native','stdio'])('%s device saves reload only the canonical audio.devices selection',async backend=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','devices-'),file=path.join(root,'config.json');
    try {
        fs.writeFileSync(file,JSON.stringify(currentConfig(backend)));
        expect((await readGuiConfig(file)).audio.devices).toEqual({source:'input',sink:'output'});
        await saveAudioDeviceIds(file,{source:'next-input',sink:'next-output'});
        const stored=JSON.parse(fs.readFileSync(file,'utf8'));
        expect(stored.client).toEqual({identity:'client-a',ipAddress:'127.0.0.1'});
        expect(stored.server).toEqual({url:'http://127.0.0.1:3000'});
        expect((await readGuiConfig(file)).audio.devices).toEqual({source:'next-input',sink:'next-output'});
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});

it.each([
    ['client.audioDevices',{client:{identity:'client-a',ipAddress:'127.0.0.1',audioDevices:{source:'old'}}}],
    ['client.typo',{client:{identity:'client-a',ipAddress:'127.0.0.1',typo:true}}],
    ['audio.typo',{audio:{backend:'native',typo:true}}],
    ['audio.devices.typo',{audio:{devices:{source:'input',sink:'output',typo:true}}}],
    ['config.typo',{typo:true}]
])('unsupported %s is rejected without rewriting configuration',async (_name,extra)=>{
    const root=checkoutPaths().temporaryDirectory('est-gui','invalid-config-'),file=path.join(root,'config.json');
    const bytes=JSON.stringify({...currentConfig(),...extra});
    try {
        fs.writeFileSync(file,bytes);
        await expect(readGuiConfig(file)).rejects.toThrow(/unknown/);
        expect(fs.readFileSync(file,'utf8')).toBe(bytes);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});

it('local-use Electron loads est-gui.config.json from the account home',async()=>{
    const home=checkoutPaths().temporaryDirectory('est-gui','config home-');
    app.getPath.mockImplementation(name=>{if(name!=='home')throw new Error('Unexpected Electron path: '+name);return home;});
    try {
        const directory=path.join(home,'effectstreamer');fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory,'est-gui.config.json'),JSON.stringify(require('../../est-gui/est-gui.config.example.json')));
        const config=await readGuiConfig();
        expect(config.client.identity).toBe('client-a');
        expect(config.server.url).toBe('http://127.0.0.1:3000');
        expect(config.audio.backend).toBe('native');
    } finally {fs.rmSync(home,{recursive:true,force:true});}
});
