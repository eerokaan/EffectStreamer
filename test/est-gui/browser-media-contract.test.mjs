import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

it('discovers independent functional and spectral media cases for every audio engine', async () => {
    const {stdout} = await promisify(execFile)(process.execPath, [path.resolve(import.meta.dirname, '../run.cjs'), 'audio-tests', '--list'], {timeout: 30000});
    for (const engine of ['chromium', 'firefox', 'webkit']) {
        const cases = stdout.split('\n').filter(line => line.includes(`[${engine}]`) && line.includes('browser-media.spec.mjs'));
        expect(cases.filter(line => line.includes('functional browser media:'))).toHaveLength(1);
        expect(cases.filter(line => line.includes('spectral browser media:'))).toHaveLength(1);
    }
}, 35000);
