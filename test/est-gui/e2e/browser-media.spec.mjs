import { test, expect } from '@playwright/test';
import { withBrowserMedia } from '../helpers/browser-media-scenario.mjs';
import { analyzeTone, decodePcmWav } from '../helpers/audio-signal.mjs';

test('functional browser media: negotiate, record, upload, continuity and shutdown', async ({browser}, testInfo) => {
    await withBrowserMedia({browser, testInfo}, async evidence => {
        // Keep the original zero-loss continuity requirement out of spectral
        // acceptance: a gap must not prevent the separate frequency report.
        for (const {index, headphones: play} of evidence) {
            const frames = (play.length - 44) / 2;
            for (let start = 24000; start + 4800 < frames - 24000; start += 4800) {
                let energy = 0;
                for (let n = 0; n < 4800; n++) energy += (play.readInt16LE(44 + 2 * (start + n)) / 32768) ** 2;
                expect(Math.sqrt(energy / 4800), `continuous zero-loss playback, participant ${index} window ${start}`).toBeGreaterThan(.01);
            }
        }
    });
});

test('spectral browser media: distinct routes and nominal-frequency integrity', async ({browser}, testInfo) => {
    await withBrowserMedia({browser, testInfo}, async evidence => {
        const reports = evidence.flatMap(({participantId, index, microphone, headphones}) => {
            const own = index ? 880 : 440, peer = index ? 440 : 880;
            return [['microphone', microphone, own, peer], ['headphones', headphones, peer, own]].map(([track, bytes, expectedHz, alternateHz]) => {
                const {samples, rate} = decodePcmWav(bytes);
                return {participantId, track, rate, expectedHz, ...analyzeTone(samples, {rate, expectedHz, alternateHz})};
            });
        });
        for (const {index, microphone, headphones} of evidence) {
            await testInfo.attach(`participant-${index}-microphone.wav`, {body: microphone, contentType: 'audio/wav'});
            await testInfo.attach(`participant-${index}-headphones.wav`, {body: headphones, contentType: 'audio/wav'});
        }
        await testInfo.attach('spectral-measurements', {body: JSON.stringify(reports, null, 2), contentType: 'application/json'});
        expect(reports.filter(report => !report.pass), 'Calibrated routing/integrity failures; see spectral-measurements').toEqual([]);
    });
});
