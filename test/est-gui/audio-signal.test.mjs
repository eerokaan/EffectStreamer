import { it, expect } from 'vitest';
import { analyzeTone, decodePcmWav } from './helpers/audio-signal.mjs';

function tone(hz, {rate = 48000, seconds = 1.5, amplitude = .3, phase = 0, leadingSeconds = 0} = {}) {
    return Float32Array.from({length: Math.round(rate * seconds)}, (_, n) => n < leadingSeconds * rate ? 0 : amplitude * Math.sin(2 * Math.PI * hz * n / rate + phase));
}
const options = (expectedHz = 440, rate = 48000) => ({rate, expectedHz, alternateHz: expectedHz === 440 ? 880 : 440});
for (const rate of [44100, 48000]) for (const hz of [440, 880]) for (const phase of [0, .3, 1.7, 3.1]) {
    it(`accepts calibrated ${hz} Hz at rate ${rate}, phase ${phase}`, () => {
        const result = analyzeTone(tone(hz, {rate, phase}), options(hz, rate));
        expect(result.pass, JSON.stringify(result)).toBe(true);
        expect(result.routing.pass).toBe(true);expect(result.integrity.pass).toBe(true);expect(result.windows).toHaveLength(3);
        for (const window of result.windows) expect(Math.abs(window.peakHz - hz)).toBeLessThan(2);
    });
}
for (const hz of [440, 880]) it(`accepts ${hz} Hz after bounded startup silence`, () => {
    const result = analyzeTone(tone(hz, {leadingSeconds: .3}), options(hz));
    expect(result.pass).toBe(true);expect(result.onsetSeconds).toBeGreaterThanOrEqual(.28);expect(result.onsetSeconds).toBeLessThanOrEqual(.32);
});
for (const [name, samples, hz] of [
    ['silence', new Float32Array(72000), 440], ['below-floor', tone(440, {amplitude: .001}), 440],
    ['swapped', tone(880), 440], ['unrelated', tone(660), 440],
    ['404.25 Hz', tone(404.25), 440], ['808.5 Hz', tone(808.5), 880],
    ['415 Hz', tone(415), 440], ['830 Hz', tone(830), 880],
    ['mislabelled rate', tone(440, {rate: 44100}), 440],
    ['late startup', tone(440, {leadingSeconds: .6}), 440], ['too short', tone(440, {seconds: .5}), 440]
]) it(`rejects invalid audio: ${name}`, () => {
    const result = analyzeTone(samples, options(hz));
    expect(result.pass).toBe(false);expect(result.integrity.pass).toBe(false);expect(result.reasons.length).toBeGreaterThan(0);
    if (name === 'swapped') expect(result.routing.pass).toBe(false);
});
it('separates shifted source identity from failed pitch integrity', () => {
    const result = analyzeTone(tone(404.25), options());expect(result.routing.pass).toBe(true);expect(result.integrity.pass).toBe(false);
});
it('rejects equal participant mixtures as routing and integrity failures', () => {
    const a = tone(440), b = tone(880), result = analyzeTone(Float32Array.from(a, (v, n) => v + b[n]), options());
    expect(result.routing.pass).toBe(false);expect(result.integrity.pass).toBe(false);
});
it('rejects unrelated contamination even when expected route dominates', () => {
    const a = tone(440), b = tone(660), result = analyzeTone(Float32Array.from(a, (v, n) => v + b[n]), options());
    expect(result.routing.pass).toBe(true);expect(result.integrity.pass).toBe(false);
});
it('rejects wrong-frequency content in a later analysis window', () => {
    const samples = tone(440);samples.set(tone(880, {seconds: .5}), 48000);
    expect(analyzeTone(samples, options()).pass).toBe(false);
});
it('refuses invalid rates and non-finite samples', () => {
    expect(() => analyzeTone(tone(440), options(440, 0))).toThrow(/rate/);
    const samples = tone(440);samples[123] = NaN;expect(() => analyzeTone(samples, options())).toThrow(/finite/);
});
function wav() {
    const b = Buffer.alloc(50);b.write('RIFF');b.writeUInt32LE(42, 4);b.write('WAVEfmt ', 8);b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);b.writeUInt16LE(1, 22);b.writeUInt32LE(48000, 24);b.writeUInt32LE(96000, 28);
    b.writeUInt16LE(2, 32);b.writeUInt16LE(16, 34);b.write('data', 36);b.writeUInt32LE(6, 40);
    b.writeInt16LE(-32768, 44);b.writeInt16LE(0, 46);b.writeInt16LE(16384, 48);return b;
}
it('decodes canonical mono PCM16 with an offset view and exact sample values', () => {
    const outer = Buffer.concat([Buffer.alloc(7), wav(), Buffer.alloc(3)]);
    const decoded = decodePcmWav(outer.subarray(7, 57));expect(decoded.rate).toBe(48000);expect([...decoded.samples]).toEqual([-1, 0, .5]);
});
for (const [name, mutate] of [
    ['container', b => b.write('NOPE')], ['encoding', b => b.writeUInt16LE(3, 20)],
    ['channels', b => b.writeUInt16LE(2, 22)], ['width', b => b.writeUInt16LE(24, 34)],
    ['data size', b => b.writeUInt32LE(8, 40)], ['RIFF size', b => b.writeUInt32LE(40, 4)],
    ['rate', b => b.writeUInt32LE(0, 24)], ['byte rate', b => b.writeUInt32LE(44100, 28)],
    ['block alignment', b => b.writeUInt16LE(4, 32)]
]) it(`rejects unsupported or malformed WAV ${name}`, () => {
    const bytes = wav();mutate(bytes);expect(() => decodePcmWav(bytes)).toThrow(/WAV|PCM|rate|length|format/);
});
it('rejects truncated and odd-length WAVs', () => {
    expect(() => decodePcmWav(wav().subarray(0, 20))).toThrow();expect(() => decodePcmWav(wav().subarray(0, 49))).toThrow();
});
