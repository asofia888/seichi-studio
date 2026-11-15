import { describe, expect, it } from 'vitest';
import {
  applyGainWithLimiter,
  dbToGain,
  LoudnessMeter,
  MasteringChain,
  MAX_BOOST_DB,
  peakDb,
  PEAK_CEILING_DB,
  PeakLimiter,
  planMastering,
} from './mastering';

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

/** Cut `channels` into blocks of the given lengths (the last length repeats) */
function* inBlocks(channels: Float32Array[], lengths: number[]): Generator<Float32Array[]> {
  let from = 0;
  for (let n = 0; from < channels[0].length; n++) {
    const to = Math.min(channels[0].length, from + lengths[Math.min(n, lengths.length - 1)]);
    yield channels.map((samples) => samples.subarray(from, to));
    from = to;
  }
}

const joined = (blocks: Float32Array[][], channel: number) => {
  const out = new Float32Array(blocks.reduce((n, b) => n + b[channel].length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block[channel], at);
    at += block[channel].length;
  }
  return out;
};

/** Where two sounds first differ (-1 when they are the same, sample for sample) */
function firstDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** A stereo mix with a quiet stretch, a loud one, and a few clicks */
function testMix(seconds = 3): Float32Array[] {
  const left = tone(0.3, seconds);
  const right = tone(0.25, seconds, 1000);
  for (let i = 0; i < left.length; i++) {
    if (i > RATE && i < RATE * 1.5) {
      left[i] *= 3;
      right[i] *= 3;
    }
  }
  for (let i = 777; i < left.length; i += 9973) left[i] = 2.5;
  return [left, right];
}

describe('PeakLimiter', () => {
  it('gives exactly the same sound however the stream is cut into blocks', () => {
    const whole = testMix();
    const expected = whole.map((samples) => samples.slice());
    applyGainWithLimiter(expected, RATE, dbToGain(4));

    for (const lengths of [[1, 2, 7, 100, 239, 240, 241, 5000], [RATE], [100000, 3], [977]]) {
      const limiter = new PeakLimiter(2, RATE, dbToGain(4));
      const blocks = [...inBlocks(whole, lengths)].map((block) => limiter.process(block));
      blocks.push(limiter.flush());
      expect(firstDifference(joined(blocks, 0), expected[0]), `blocks of ${lengths}`).toBe(-1);
      expect(firstDifference(joined(blocks, 1), expected[1]), `blocks of ${lengths}`).toBe(-1);
    }
  });

  it('gives back as many samples as it was given, even for a sound shorter than its lookahead', () => {
    const limiter = new PeakLimiter(1, RATE, 1);
    const out = [limiter.process([Float32Array.from([0.1, 2, 0.1])]), limiter.flush()];
    const sound = joined(out, 0);
    expect(sound.length).toBe(3);
    expect(Math.max(...sound)).toBeLessThanOrEqual(CEILING + 1e-6);
    expect(limiter.flush()[0].length, 'nothing more after the end').toBe(0);
  });
});

describe('LoudnessMeter', () => {
  const measure = (channels: Float32Array[], lengths = [RATE]) => {
    const meter = new LoudnessMeter(channels.length);
    for (const block of inBlocks(channels, lengths)) meter.process(block);
    return meter.integrated();
  };

  it('measures a 997 Hz tone at -20 dBFS on both speakers as -20 LUFS minus the 3 dB of the standard', () => {
    // BS.1770: a 0 dBFS 997 Hz sine on one channel reads -3.01 LKFS; on both channels it reads 0
    const sine = tone(0.1, 5, 997);
    expect(measure([sine, sine.slice()])).toBeCloseTo(-20, 1);
    expect(measure([sine, new Float32Array(sine.length)])).toBeCloseTo(-23, 1);
  });

  it('counts a mono sound as playing on both speakers', () => {
    expect(measure([tone(0.1, 5, 997)])).toBeCloseTo(-20, 1);
  });

  it('follows the gain: twice the amplitude is 6 dB louder', () => {
    const quiet = measure([tone(0.05, 3), tone(0.05, 3)])!;
    const loud = measure([tone(0.1, 3), tone(0.1, 3)])!;
    expect(loud - quiet).toBeCloseTo(6, 1);
  });

  it('leaves the silent parts out, so pauses do not make a video count as quieter', () => {
    const sine = tone(0.1, 3, 997);
    const withPause = new Float32Array(RATE * 10);
    withPause.set(sine, 0);
    withPause.set(sine, RATE * 7);
    // Averaged over all ten seconds it would be -22.2; only the blocks at the tone's edges pull it down a little
    const lufs = measure([withPause, withPause.slice()])!;
    expect(lufs).toBeGreaterThan(-20.4);
    expect(lufs).toBeLessThanOrEqual(-20);
  });

  it('is null for silence and for a sound too short to measure', () => {
    expect(measure([new Float32Array(RATE)])).toBeNull();
    expect(measure([tone(0.5, 0.3)])).toBeNull();
  });

  it('measures the same however the stream is cut into blocks', () => {
    const mix = testMix();
    const expected = measure(mix, [mix[0].length]);
    expect(expected).not.toBeNull();
    for (const lengths of [[1000], [4799, 1, 4801, 33], [480000]]) expect(measure(mix, lengths)).toBe(expected);
  });
});

describe('planMastering / MasteringChain', () => {
  const TARGET = -14;
  const reader = (mix: Float32Array[], lengths = [RATE / 2]) => {
    let reads = 0;
    const read = async function* () {
      reads++;
      for (const block of inBlocks(mix, lengths)) yield block.map((samples) => samples.slice());
    };
    return { read, reads: () => reads };
  };
  const master = async (mix: Float32Array[], target: number | null, lengths?: number[]) => {
    const { read, reads } = reader(mix, lengths);
    const plan = await planMastering(read, mix.length, RATE, target);
    const chain = new MasteringChain(mix.length, RATE, plan);
    const blocks: Float32Array[][] = [];
    for await (const block of read()) blocks.push(chain.process(block));
    blocks.push(chain.flush());
    return { plan, levels: chain.levels(), sound: mix.map((_, c) => joined(blocks, c)), measuringReads: reads() - 1 };
  };

  it('raises a quiet mix to the target with one gain, reading it once to measure', async () => {
    const mix = [tone(0.05, 4, 997), tone(0.05, 4, 997)]; // -26 LUFS
    const { plan, levels, sound, measuringReads } = await master(mix, TARGET);
    expect(plan.stagesDb).toHaveLength(1);
    expect(plan.stagesDb[0]).toBeCloseTo(12, 0);
    expect(levels.lufs).toBeCloseTo(TARGET, 1);
    expect(levels.gainDb).toBeCloseTo(12, 0);
    expect(sound[0].length).toBe(mix[0].length);
    expect(measuringReads, 'the limiter has nothing to do, so one reading is enough').toBe(1);
  });

  it('never raises a mix by more than the limit', async () => {
    const mix = [tone(0.005, 3, 997), tone(0.005, 3, 997)]; // -46 LUFS
    const { plan, levels } = await master(mix, TARGET);
    expect(plan.stagesDb).toEqual([MAX_BOOST_DB]);
    expect(levels.lufs).toBeCloseTo(-34, 0);
  });

  it('tops the gain up when limiting the peaks took loudness off, and still never clips', async () => {
    // A quiet tone with a short loud burst ten times a second: the bursts carry most of the
    // loudness, and they are what the limiter has to turn down
    const left = tone(0.05, 6, 997);
    for (let i = 0; i < left.length; i++) if (i % 4800 < 96) left[i] *= 20;
    const mix = [left, left.slice()];
    const { plan, levels, sound, measuringReads } = await master(mix, TARGET);
    expect(plan.stagesDb.length).toBe(2);
    expect(measuringReads).toBe(2);
    expect(levels.peakDb).toBeLessThanOrEqual(PEAK_CEILING_DB + 0.05);
    expect(peakDb(sound)).toBeLessThanOrEqual(PEAK_CEILING_DB + 1e-6);
    expect(levels.gainDb).toBeLessThanOrEqual(MAX_BOOST_DB);
    expect(sound[0].length).toBe(mix[0].length);
  });

  it('turns a mix that is too loud down to the target', async () => {
    const mix = [tone(0.8, 3, 997), tone(0.8, 3, 997)]; // about -2 LUFS
    const { plan, levels } = await master(mix, TARGET);
    expect(plan.stagesDb[0]).toBeCloseTo(-12, 0);
    expect(levels.lufs).toBeCloseTo(TARGET, 1);
  });

  it('only limits the peaks when no target is chosen, without reading the mix beforehand', async () => {
    const mix = testMix();
    const { plan, levels, measuringReads } = await master(mix, null);
    expect(plan.stagesDb).toEqual([0]);
    expect(measuringReads).toBe(0);
    expect(levels.gainDb).toBe(0);
    expect(levels.peakDb).toBeLessThanOrEqual(PEAK_CEILING_DB + 0.05);
  });

  it('gives the same result as mastering the whole mix at once, however it is cut into blocks', async () => {
    const mix = testMix(4);
    const whole = await master(mix, TARGET, [mix[0].length]);
    const cut = await master(mix, TARGET, [48000, 4800, 131, 99999]);
    expect(cut.plan).toEqual(whole.plan);
    expect(cut.levels).toEqual(whole.levels);
    expect(firstDifference(cut.sound[0], whole.sound[0])).toBe(-1);
    expect(firstDifference(cut.sound[1], whole.sound[1])).toBe(-1);
  });

  it('leaves a silent mix alone', async () => {
    const { plan, levels } = await master([new Float32Array(RATE), new Float32Array(RATE)], TARGET);
    expect(plan.stagesDb).toEqual([0]);
    expect(levels.lufs).toBeNull();
    expect(levels.peakDb).toBe(-Infinity);
  });
});
