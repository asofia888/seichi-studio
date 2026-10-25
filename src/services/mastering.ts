/**
 * Final touch on the exported soundtrack: one gain for the whole mix and a peak limiter, so the
 * video is as loud as the platform expects and never clips. Pure functions on sample arrays
 * (the loudness itself is measured with the Web Audio API, see measureBufferLoudness).
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
 * Multiply the sound by `gain` and turn down any moment that would go above `ceilingDb`.
 * All channels get the same gain, so the stereo image does not shift. Works in place, sample by
 * sample, so even a long soundtrack needs no second copy in memory.
 *
 * How the limiter gain is found for each sample:
 * 1. the gain that sample needs to stay under the ceiling;
 * 2. the smallest of those over the next LOOKAHEAD samples;
 * 3. the average of (2) over the previous LOOKAHEAD samples, which turns each step into a ramp.
 *    Every value averaged at a peak already includes that peak, so the peak always gets at
 *    least the reduction it needs;
 * 4. the gain falls at once but recovers over RELEASE_SEC.
 */
export function applyGainWithLimiter(
  channels: Float32Array[],
  sampleRate: number,
  gain: number,
  ceilingDb = PEAK_CEILING_DB
): void {
  const length = channels[0]?.length ?? 0;
  const channelCount = channels.length;
  const ceiling = dbToGain(ceilingDb);
  const lookahead = Math.max(1, Math.round(LOOKAHEAD_SEC * sampleRate));
  const window = lookahead + 1;
  const release = 1 - Math.exp(-1 / (RELEASE_SEC * sampleRate));

  // Step 2: the samples among the last `window` whose step 1 gain can still be the smallest,
  // oldest first (their gains increase from front to back). A ring of `window + 1` slots.
  const capacity = window + 1;
  const queueIndex = new Int32Array(capacity);
  const queueNeed = new Float32Array(capacity);
  let queueHead = 0;
  let queueLength = 0;
  // Step 3: the step 2 gains of the last `window` samples and their sum
  const smallest = new Float64Array(window);
  let smallestPos = 0;
  let smallestSum = 0;
  let limiterGain = 1;

  // Sample i is looked at `lookahead` samples before sample j = i - lookahead is written
  const end = length + lookahead;
  for (let i = 0; i < end; i++) {
    // Step 1 (silence after the end)
    let need = 1;
    if (i < length) {
      let peak = 0;
      for (let c = 0; c < channelCount; c++) {
        const v = Math.abs(channels[c][i] * gain);
        if (v > peak) peak = v;
      }
      if (peak > ceiling) need = ceiling / peak;
    }

    // Step 2
    while (queueLength > 0) {
      let back = queueHead + queueLength - 1;
      if (back >= capacity) back -= capacity;
      if (queueNeed[back] < need) break;
      queueLength--;
    }
    let tail = queueHead + queueLength;
    if (tail >= capacity) tail -= capacity;
    queueIndex[tail] = i;
    queueNeed[tail] = need;
    queueLength++;
    while (queueIndex[queueHead] < i - lookahead) {
      queueHead = queueHead + 1 === capacity ? 0 : queueHead + 1;
      queueLength--;
    }

    const j = i - lookahead;
    if (j < 0) continue;

    // Step 3
    const ahead = queueNeed[queueHead];
    smallestSum += ahead - (j >= window ? smallest[smallestPos] : 0);
    smallest[smallestPos] = ahead;
    smallestPos = smallestPos + 1 === window ? 0 : smallestPos + 1;
    const ramped = smallestSum / (j + 1 < window ? j + 1 : window);

    // Step 4
    limiterGain = ramped < limiterGain ? ramped : limiterGain + (ramped - limiterGain) * release;
    const total = gain * limiterGain;
    for (let c = 0; c < channelCount; c++) {
      // The clamp only catches rounding error; the gain above already keeps the sample in range
      const v = channels[c][j] * total;
      channels[c][j] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
    }
  }
}
