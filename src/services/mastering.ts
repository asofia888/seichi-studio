/**
 * Final touch on the exported soundtrack: one gain for the whole mix and a peak limiter, so the
 * video is as loud as the platform expects and never clips.
 *
 * Everything here works on a stream of sample blocks, so an hour-long soundtrack is never held
 * in memory: it is produced a few seconds at a time, once to measure it and once more to
 * encode it (see planMastering and MasteringChain).
 */

/**
 * Highest sample level the limiter lets through. YouTube recommends peaks below -1 dBTP; the
 * extra half decibel leaves room for the encoder (AAC / Opus), which can push peaks up slightly.
 */
export const PEAK_CEILING_DB = -1.5;
/** A quiet mix is raised by at most this much, so hiss and room noise are not pumped up */
export const MAX_BOOST_DB = 12;

// The gain starts falling this long before a peak, so the peak is never cut off abruptly
const LOOKAHEAD_SEC = 0.005;
// ...and comes back up over about this long after it
const RELEASE_SEC = 0.1;

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Highest absolute sample over all channels, in dBFS (-Infinity when silent) */
export function peakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Multiplies the sound by `gain` and turns down any moment that would go above `ceilingDb`.
 * All channels get the same gain, so the stereo image does not shift. The sound is fed in
 * blocks of any size and comes out LOOKAHEAD later; the result does not depend on where the
 * blocks are cut.
 *
 * How the limiter gain is found for each sample:
 * 1. the gain that sample needs to stay under the ceiling;
 * 2. the smallest of those over the next LOOKAHEAD samples;
 * 3. the average of (2) over the previous LOOKAHEAD samples, which turns each step into a ramp.
 *    Every value averaged at a peak already includes that peak, so the peak always gets at
 *    least the reduction it needs;
 * 4. the gain falls at once but recovers over RELEASE_SEC.
 */
export class PeakLimiter {
  private readonly ceiling: number;
  private readonly lookahead: number;
  private readonly window: number;
  private readonly release: number;

  // Step 2: the samples among the last `window` whose step 1 gain can still be the smallest,
  // oldest first (their gains increase from front to back). A ring of `window + 1` slots.
  private readonly capacity: number;
  private readonly queueIndex: Float64Array;
  private readonly queueNeed: Float32Array;
  private queueHead = 0;
  private queueLength = 0;
  // Step 3: the step 2 gains of the last `window` samples and their sum
  private readonly smallest: Float64Array;
  private smallestPos = 0;
  private smallestSum = 0;
  private limiterGain = 1;

  // The last `lookahead` samples read, which have not been written yet (a ring per channel)
  private readonly held: Float32Array[];
  private heldPos = 0;
  /** Samples read so far */
  private read = 0;
  private flushed = false;

  constructor(
    private readonly channelCount: number,
    sampleRate: number,
    private readonly gain: number,
    ceilingDb = PEAK_CEILING_DB
  ) {
    this.ceiling = dbToGain(ceilingDb);
    this.lookahead = Math.max(1, Math.round(LOOKAHEAD_SEC * sampleRate));
    this.window = this.lookahead + 1;
    this.release = 1 - Math.exp(-1 / (RELEASE_SEC * sampleRate));
    this.capacity = this.window + 1;
    this.queueIndex = new Float64Array(this.capacity);
    this.queueNeed = new Float32Array(this.capacity);
    this.smallest = new Float64Array(this.window);
    this.held = Array.from({ length: channelCount }, () => new Float32Array(this.lookahead));
  }

  /** Feed the next block; returns the samples that are finished (the block's length, less the lookahead on the first call) */
  process(input: Float32Array[]): Float32Array[] {
    return this.run(input, input[0]?.length ?? 0);
  }

  /** After the last block: the samples still held back */
  flush(): Float32Array[] {
    if (this.flushed) return this.held.map(() => new Float32Array(0));
    this.flushed = true;
    return this.run(null, this.lookahead);
  }

  /** Runs `count` steps: reading from `input`, or silence after the end when it is null */
  private run(input: Float32Array[] | null, count: number): Float32Array[] {
    const { channelCount, gain, ceiling, lookahead, window, capacity, release } = this;
    const { queueIndex, queueNeed, smallest, held } = this;
    // Sample i is looked at `lookahead` samples before sample j = i - lookahead is written
    const alreadyWritten = Math.max(0, this.read - lookahead);
    const writtenAfter = input ? Math.max(0, this.read + count - lookahead) : this.read;
    const output = held.map(() => new Float32Array(writtenAfter - alreadyWritten));
    let written = 0;

    for (let n = 0; n < count; n++) {
      const i = this.read + n;
      // Step 1 (silence after the end)
      let need = 1;
      if (input) {
        let peak = 0;
        for (let c = 0; c < channelCount; c++) {
          const v = Math.abs(input[c][n] * gain);
          if (v > peak) peak = v;
        }
        if (peak > ceiling) need = ceiling / peak;
      }

      // Step 2
      while (this.queueLength > 0) {
        let back = this.queueHead + this.queueLength - 1;
        if (back >= capacity) back -= capacity;
        if (queueNeed[back] < need) break;
        this.queueLength--;
      }
      let tail = this.queueHead + this.queueLength;
      if (tail >= capacity) tail -= capacity;
      queueIndex[tail] = i;
      queueNeed[tail] = need;
      this.queueLength++;
      while (queueIndex[this.queueHead] < i - lookahead) {
        this.queueHead = this.queueHead + 1 === capacity ? 0 : this.queueHead + 1;
        this.queueLength--;
      }

      const j = i - lookahead;
      if (j >= 0) {
        // Step 3
        const ahead = queueNeed[this.queueHead];
        this.smallestSum += ahead - (j >= window ? smallest[this.smallestPos] : 0);
        smallest[this.smallestPos] = ahead;
        this.smallestPos = this.smallestPos + 1 === window ? 0 : this.smallestPos + 1;
        const ramped = this.smallestSum / (j + 1 < window ? j + 1 : window);

        // Step 4
        this.limiterGain =
          ramped < this.limiterGain ? ramped : this.limiterGain + (ramped - this.limiterGain) * release;
        const total = gain * this.limiterGain;
        for (let c = 0; c < channelCount; c++) {
          // The clamp only catches rounding error; the gain above already keeps the sample in range
          const v = held[c][this.heldPos] * total;
          output[c][written] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
        }
        written++;
      }

      // Sample i takes the place of the one just written
      for (let c = 0; c < channelCount; c++) held[c][this.heldPos] = input ? input[c][n] : 0;
      this.heldPos = this.heldPos + 1 === lookahead ? 0 : this.heldPos + 1;
    }
    if (input) this.read += count;
    return output;
  }
}

/** The whole of `channels` through a PeakLimiter, in place */
export function applyGainWithLimiter(
  channels: Float32Array[],
  sampleRate: number,
  gain: number,
  ceilingDb = PEAK_CEILING_DB
): void {
  const length = channels[0]?.length ?? 0;
  const limiter = new PeakLimiter(channels.length, sampleRate, gain, ceilingDb);
  let written = 0;
  const write = (finished: Float32Array[]) => {
    // What comes out was read earlier, so it never lands on samples still to be read
    finished.forEach((samples, c) => channels[c].set(samples, written));
    written += finished[0]?.length ?? 0;
  };
  for (let from = 0; from < length; from += sampleRate) {
    write(limiter.process(channels.map((samples) => samples.subarray(from, Math.min(length, from + sampleRate)))));
  }
  write(limiter.flush());
}

// ---------------------------------------------------------------------------
// Loudness
// ---------------------------------------------------------------------------

/** The rate the standard's K-weighting coefficients are published for */
export const LOUDNESS_SAMPLE_RATE = 48000;

// K-weighting, BS.1770-4 Table 1 (pre-filter) and Table 2 (RLB high-pass) at 48 kHz: [b0, b1, b2, a1, a2]
const PRE_FILTER = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const RLB_FILTER = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
const LOUDNESS_STEP = LOUDNESS_SAMPLE_RATE / 10;

/**
 * Integrated loudness in LUFS per ITU-R BS.1770 / EBU R128 of 48 kHz sound fed in blocks of any
 * size: K-weighting, 400 ms blocks with 75% overlap, absolute gate at -70 LUFS and relative gate
 * at -10 LU. It keeps ten numbers per second of sound, whatever the length.
 */
export class LoudnessMeter {
  // Filter memories per channel: two for each of the two filters (transposed direct form II)
  private readonly state: Float64Array[];
  /** Mean square of each finished 100 ms step, all channels added */
  private stepPower: number[] = [];
  private stepSum = 0;
  private stepFill = 0;

  constructor(private readonly channelCount: number) {
    this.state = Array.from({ length: channelCount }, () => new Float64Array(4));
  }

  process(input: Float32Array[]): void {
    const length = input[0]?.length ?? 0;
    const [b0, b1, b2, a1, a2] = PRE_FILTER;
    const [d0, d1, d2, c1, c2] = RLB_FILTER;
    let offset = 0;
    while (offset < length) {
      const count = Math.min(length - offset, LOUDNESS_STEP - this.stepFill);
      for (let c = 0; c < this.channelCount; c++) {
        const samples = input[c];
        const z = this.state[c];
        let [z0, z1, z2, z3] = z;
        let sum = 0;
        for (let i = offset; i < offset + count; i++) {
          const x = samples[i];
          const y = b0 * x + z0;
          z0 = b1 * x - a1 * y + z1;
          z1 = b2 * x - a2 * y;
          const w = d0 * y + z2;
          z2 = d1 * y - c1 * w + z3;
          z3 = d2 * y - c2 * w;
          sum += w * w;
        }
        z[0] = z0;
        z[1] = z1;
        z[2] = z2;
        z[3] = z3;
        this.stepSum += sum;
      }
      offset += count;
      this.stepFill += count;
      if (this.stepFill === LOUDNESS_STEP) {
        this.stepPower.push(this.stepSum / LOUDNESS_STEP);
        this.stepSum = 0;
        this.stepFill = 0;
      }
    }
  }

  /** Loudness of everything fed so far, rounded to 0.1 LUFS; null when it is silent (or shorter than 0.4 s) */
  integrated(): number | null {
    const steps = this.stepPower;
    // A mono file is played on both speakers, which adds 3 dB compared with measuring one channel
    const channelFactor = this.channelCount === 1 ? 2 : 1;
    const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);

    // A 400 ms block is four consecutive steps
    const blocks: number[] = [];
    for (let s = 0; s + 4 <= steps.length; s++) {
      const power = ((steps[s] + steps[s + 1] + steps[s + 2] + steps[s + 3]) / 4) * channelFactor;
      if (power > 0 && toLufs(power) > -70) blocks.push(power);
    }
    if (blocks.length === 0) return null;
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const relativeGate = toLufs(mean(blocks)) - 10;
    return Math.round(toLufs(mean(blocks.filter((p) => toLufs(p) > relativeGate))) * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// Mastering a soundtrack that is produced block by block
// ---------------------------------------------------------------------------

// Close enough to the target loudness; YouTube's own measurement varies by about this much
const LOUDNESS_TOLERANCE_LU = 0.5;

/** What to do to the mix: each stage is one gain (dB) followed by a peak limiter */
export interface MasteringPlan {
  stagesDb: number[];
}

/** Hands out the mix from its beginning, block by block (the same sound every time it is called) */
export type MixReader = () => AsyncIterable<Float32Array[]>;

/**
 * Decide how to bring the mix to `targetLufs` with one gain for the whole soundtrack (raising it
 * by at most MAX_BOOST_DB) while every peak stays under the limiter's ceiling. Limiting the
 * loudest moments takes a little loudness off, so the gain is topped up once if it fell short.
 * The mix is read once to measure it, and once more only if the limiter will have work to do.
 * With no target, the mix is only limited and nothing needs measuring first.
 */
export async function planMastering(
  readMix: MixReader,
  channelCount: number,
  sampleRate: number,
  targetLufs: number | null
): Promise<MasteringPlan> {
  if (targetLufs === null) return { stagesDb: [0] };

  const raw = new LoudnessMeter(channelCount);
  let rawPeak = 0;
  for await (const block of readMix()) {
    raw.process(block);
    for (const samples of block) {
      for (let i = 0; i < samples.length; i++) {
        const v = Math.abs(samples[i]);
        if (v > rawPeak) rawPeak = v;
      }
    }
  }
  const rawLufs = raw.integrated();
  if (rawLufs === null) return { stagesDb: [0] };

  const gainDb = Math.min(MAX_BOOST_DB, targetLufs - rawLufs);
  // Nothing reaches the ceiling: the limiter changes nothing, so the loudness lands where it was aimed
  if (rawPeak * dbToGain(gainDb) <= dbToGain(PEAK_CEILING_DB) || gainDb >= MAX_BOOST_DB) return { stagesDb: [gainDb] };

  const limited = new LoudnessMeter(channelCount);
  const limiter = new PeakLimiter(channelCount, sampleRate, dbToGain(gainDb));
  for await (const block of readMix()) limited.process(limiter.process(block));
  limited.process(limiter.flush());
  const lufs = limited.integrated();
  if (lufs !== null && lufs < targetLufs - LOUDNESS_TOLERANCE_LU) {
    return { stagesDb: [gainDb, Math.min(MAX_BOOST_DB - gainDb, targetLufs - lufs)] };
  }
  return { stagesDb: [gainDb] };
}

/** Carries out a MasteringPlan on the mix as it is produced, and measures what comes out */
export class MasteringChain {
  private readonly limiters: PeakLimiter[];
  private readonly meter: LoudnessMeter;
  private peak = 0;

  constructor(
    channelCount: number,
    sampleRate: number,
    private readonly plan: MasteringPlan
  ) {
    this.limiters = plan.stagesDb.map((db) => new PeakLimiter(channelCount, sampleRate, dbToGain(db)));
    this.meter = new LoudnessMeter(channelCount);
  }

  /** Feed the next block of the mix; returns the finished sound that is ready so far */
  process(block: Float32Array[]): Float32Array[] {
    return this.measure(this.limiters.reduce((sound, limiter) => limiter.process(sound), block));
  }

  /** After the last block: the rest of the finished sound */
  flush(): Float32Array[] {
    // What an earlier stage was still holding goes through the later ones before they finish too
    let pending: Float32Array[] | null = null;
    for (const limiter of this.limiters) {
      const before: Float32Array[] | null = pending ? limiter.process(pending) : null;
      const rest = limiter.flush();
      pending = before ? before.map((samples, c) => joinSamples(samples, rest[c])) : rest;
    }
    return this.measure(pending ?? []);
  }

  private measure(sound: Float32Array[]): Float32Array[] {
    this.meter.process(sound);
    for (const samples of sound) {
      for (let i = 0; i < samples.length; i++) {
        const v = Math.abs(samples[i]);
        if (v > this.peak) this.peak = v;
      }
    }
    return sound;
  }

  /** How loud the finished sound is (so far) */
  levels(): { lufs: number | null; gainDb: number; peakDb: number } {
    const gainDb = this.plan.stagesDb.reduce((a, b) => a + b, 0);
    const peak = this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
    return { lufs: this.meter.integrated(), gainDb: Math.round(gainDb * 10) / 10, peakDb: Math.round(peak * 10) / 10 };
  }
}

function joinSamples(a: Float32Array, b: Float32Array): Float32Array {
  const joined = new Float32Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}
