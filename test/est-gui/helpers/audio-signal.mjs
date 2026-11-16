// Acceptance for continuous synthetic two-participant tones, not speech/audio quality.
function rms(samples, start, count) {
  let sum = 0;
  for (let n = start; n < start + count; n++) sum += samples[n] ** 2;
  return Math.sqrt(sum / count);
}

function spectrum(samples, start, count, rate, expectedHz, alternateHz) {
  const size = 2 ** Math.ceil(Math.log2(count));
  const real = new Float64Array(size), imag = new Float64Array(size);
  let mean = 0;
  for (let n = 0; n < count; n++) mean += samples[start + n] / count;
  for (let n = 0; n < count; n++) real[n] = (samples[start + n] - mean) * (.5 - .5 * Math.cos(2 * Math.PI * n / (count - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= size; length *= 2) for (let begin = 0; begin < size; begin += length) {
    for (let n = 0; n < length / 2; n++) {
      const angle = -2 * Math.PI * n / length, a = begin + n, b = a + length / 2;
      const r = real[b] * Math.cos(angle) - imag[b] * Math.sin(angle);
      const i = real[b] * Math.sin(angle) + imag[b] * Math.cos(angle);
      real[b] = real[a] - r;imag[b] = imag[a] - i;real[a] += r;imag[a] += i;
    }
  }
  const power = n => real[n] ** 2 + imag[n] ** 2;
  let best = 1, total = 0, expectedPower = 0, alternatePower = 0, nominalPower = 0;
  for (let n = 1; n <= size / 2; n++) {
    const hz = n * rate / size, value = power(n);total += value;
    if (value > power(best)) best = n;
    if (Math.abs(hz - expectedHz) <= expectedHz * .12) expectedPower += value;
    if (Math.abs(hz - alternateHz) <= alternateHz * .12) alternatePower += value;
    if (Math.abs(hz - expectedHz) <= 8) nominalPower += value;
  }
  let offset = 0;
  if (best > 1 && best < size / 2) {
    const a = Math.log(power(best - 1) + 1e-30), b = Math.log(power(best) + 1e-30), c = Math.log(power(best + 1) + 1e-30);
    const denominator = a - 2 * b + c;
    if (denominator) offset = .5 * (a - c) / denominator;
  }
  return { peakHz: total > 1e-20 ? (best + offset) * rate / size : null,
    expectedPower, alternatePower, purity: total ? nominalPower / total : 0 };
}

export function analyzeTone(samples, { rate, expectedHz, alternateHz }) {
  if (!Number.isSafeInteger(rate) || rate < 1000) throw new Error('Invalid sample rate');
  if (![expectedHz, alternateHz].every(hz => Number.isFinite(hz) && hz > 0 && hz < rate / 2) || expectedHz === alternateHz) throw new Error('Invalid expected/alternate frequencies');
  if (!(samples instanceof Float32Array) || samples.some(value => !Number.isFinite(value))) throw new Error('PCM must contain finite Float32 samples');
  const result = { pass: false, routing: { pass: false }, integrity: { pass: false }, onsetSeconds: null, windows: [], reasons: [] };
  const frame = Math.round(rate * .02);
  let streak = 0, onset = null;
  for (let start = 0; start + frame <= samples.length && start <= Math.round(rate * .56); start += frame) {
    streak = rms(samples, start, frame) >= .01 ? streak + 1 : 0;
    if (streak === 3) {onset = start - 2 * frame;break;}
  }
  if (onset === null || onset / rate > .5) {result.reasons.push('No sustained onset within 500 ms');return result;}
  result.onsetSeconds = onset / rate;
  const first = onset + Math.round(rate * .1), end = samples.length - Math.round(rate * .1), count = Math.round(rate * .25);
  if (end - first < count * 3) {result.reasons.push('Less than 750 ms of analyzable signal');return result;}
  for (let index = 0; index < 3; index++) {
    const start = first + Math.round(index * (end - first - count) / 2);
    const window = { startSeconds: start / rate, rms: rms(samples, start, count), ...spectrum(samples, start, count, rate, expectedHz, alternateHz) };
    window.routingPass = window.expectedPower > 10 * window.alternatePower;
    window.integrityPass = window.rms >= .01 && window.peakHz !== null && Math.abs(window.peakHz - expectedHz) <= 2 && window.purity >= .9;
    if (!window.routingPass) result.reasons.push(`Window ${index}: expected route does not dominate`);
    if (!window.integrityPass) result.reasons.push(`Window ${index}: RMS, nominal frequency or purity failed`);
    result.windows.push(window);
  }
  result.routing.pass = result.windows.every(window => window.routingPass);
  result.integrity.pass = result.windows.every(window => window.integrityPass);
  result.pass = result.routing.pass && result.integrity.pass;
  return result;
}

// Deliberately strict: these tests consume the application's canonical 44-byte,
// mono PCM16 WAVs, not arbitrary WAV variants or container metadata chunks.
export function decodePcmWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44 || bytes.length % 2) throw new Error('Invalid WAV length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, count) => String.fromCharCode(...bytes.subarray(start, start + count));
  if (text(0, 4) !== 'RIFF' || text(8, 8) !== 'WAVEfmt ' || text(36, 4) !== 'data' || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16 || view.getUint16(32, true) !== 2) throw new Error('Unsupported WAV PCM format');
  if (view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(40, true) !== bytes.length - 44) throw new Error('Inconsistent WAV data length');
  const rate = view.getUint32(24, true);
  if (rate < 1000 || view.getUint32(28, true) !== rate * 2) throw new Error('Invalid WAV sample/byte rate');
  const samples = Float32Array.from({ length: (bytes.length - 44) / 2 }, (_, n) => view.getInt16(44 + n * 2, true) / 32768);
  return { samples, rate };
}
