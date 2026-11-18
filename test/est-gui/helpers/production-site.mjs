import { test as base } from '@playwright/test';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCoordinator } from '../../../est-server/src/server.js';
import { preview } from '../tools.mjs';

const guiRoot = path.resolve(import.meta.dirname, '../../../est-gui');
const outDir = path.join(guiRoot, 'dist/web');

export const test = base.extend({
    startProductionSite: async ({}, use, testInfo) => {
        // Programmatic preview doesn't check for a missing build at startup.
        await fs.access(path.join(outDir, 'index.html')).catch(cause => {
            throw new Error('Production UI tests require est-gui/dist/web; run npm --prefix est-gui run build:web', { cause });
        });
        // Keep recordings from failed runs in place, including on test timeout.
        const root = testInfo.outputPath('synthetic-failure-fixture');
        await fs.mkdir(root, { recursive: true });
        let app, host;
        try {
            await use(async config => {
                app = createCoordinator({ config, root });
                await app.ready;
                app.server.listen(0, '127.0.0.1');
                await once(app.server, 'listening');
                const target = `http://127.0.0.1:${app.server.address().port}`;
                host = await preview({
                    configFile: false, root: guiRoot, build: { outDir },
                    appType: 'spa', // Direct /experiment links use the same built index as /.
                    preview: { host: '127.0.0.1', port: 0, proxy: { '/api/': target, '/socket.io/': { target, ws: true } } }
                });
                return { app, url: `http://127.0.0.1:${host.httpServer.address().port}` };
            });
        } finally {
            try { await app?.close(); } finally {
                await host?.close();
                if (testInfo.status === testInfo.expectedStatus) await fs.rm(root, { recursive: true, force: true });
            }
        }
    }
});
