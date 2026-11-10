import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
vi.mock('electron',()=>({app:{getPath:vi.fn()}}));
import {app} from 'electron';
import {readGuiConfig} from '../src/main/lib/config.js';
const require=createRequire(import.meta.url),{checkoutPaths}=require('../../common/transient-paths.cjs');

it('local-use Electron loads est-gui.config.json from the account home',async()=>{
    const home=checkoutPaths().temporaryDirectory('est-gui','config home-');
    app.getPath.mockImplementation(name=>{if(name!=='home')throw new Error('Unexpected Electron path: '+name);return home;});
    try {
        const directory=path.join(home,'effectstreamer');fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory,'est-gui.config.json'),JSON.stringify(require('../est-gui.config.example.json')));
        const config=await readGuiConfig();
        expect(config.client.identity).toBe('client-a');
        expect(config.server.url).toBe('http://127.0.0.1:3000');
        expect(config.audio.backend).toBe('native');
    } finally {fs.rmSync(home,{recursive:true,force:true});}
});
