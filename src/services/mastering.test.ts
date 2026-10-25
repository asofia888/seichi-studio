import { describe, expect, it } from 'vitest';
import { applyGainWithLimiter, dbToGain, peakDb, PEAK_CEILING_DB } from './mastering';

const RATE = 48000;
const CEILING = dbToGain(PEAK_CEILING_DB);

/** A tone of `amplitude` lasting `seconds` */
const tone = (amplitude: number, seconds: number, freq = 440) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / RATE));

describe('applyGainWithLimiter', () => {
  it('only applies the gain when nothing goes above the ceiling', () => {
    const left = tone(0.2, 0.5);
    const original = left.slice();
    applyGainWithLimiter([left], RATE, 2);
    left.forEach((v, i) => expect(v).toBeCloseTo(original[i] * 2, 6));
  });

  it('keeps every sample under the ceiling, however loud the input', () => {
    const left = tone(0.5, 1);
    const right = tone(0.5, 1, 1000);
    for (let i = 0; i < left.length; i += 4801) left[i] = 3; // sudden clicks
    applyGainWithLimiter([left, right], RATE, dbToGain(9));
    expect(peakDb([left, right])).toBeLessThanOrEqual(PEAK_CEILING_DB + 1e-6);
  });

  it('turns the sound down smoothly before a loud moment and back up after it', () => {
    const left = new Float32Array(RATE).fill(0.1);
    const peakAt = RATE / 2;
    left[peakAt] = 1;
    applyGainWithLimiter([left], RATE, 1);

    expect(left[peakAt]).toBeCloseTo(CEILING, 4);
    expect(left[peakAt - 120], 'already lower 2.5 ms before the peak').toBeLessThan(0.1 - 1e-4);
    expect(left[peakAt - 1000], 'untouched well before the peak').toBeCloseTo(0.1, 6);
    expect(left[peakAt + 2400], 'still recovering 50 ms after').toBeLessThan(0.1);
    expect(left[left.length - 1], 'back to normal after the release').toBeCloseTo(0.1, 3);
  });

  it('lowers both channels together, so a loud left side does not pull the sound to the right', () => {
    const left = new Float32Array(RATE / 10).fill(0.9);
    const right = new Float32Array(RATE / 10).fill(0.3);
    applyGainWithLimiter([left, right], RATE, 1);
    const mid = left.length / 2;
    expect(left[mid] / right[mid]).toBeCloseTo(3, 4);
  });
});

describe('peakDb', () => {
  it('reports the loudest sample in dBFS, and -Infinity for silence', () => {
    expect(peakDb([Float32Array.from([0.1, -0.5]), Float32Array.from([0.25])])).toBeCloseTo(-6.02, 2);
    expect(peakDb([new Float32Array(10)])).toBe(-Infinity);
  });
});
