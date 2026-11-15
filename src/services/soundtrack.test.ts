import { describe, expect, it } from 'vitest';
import {
  addPiece,
  downmixToStereo,
  duckEnvelope,
  envelopeValueAt,
  fadeEnvelope,
  MIX_SAMPLE_RATE,
  mixVoice,
  planSoundtrack,
  Voice,
  voicePieces,
  VoiceSource,
  writeEnvelope,
} from './soundtrack';
import { duckGainAt, mergeSpans } from './audioEngine';
import { makeProject } from '../test/makeProject';
import { AudioTrackItem, VideoClipItem } from '../types';

const RATE = MIX_SAMPLE_RATE;

const track = (id: string, type: AudioTrackItem['type'], startTime: number, duration: number, parts: Partial<AudioTrackItem> = {}): AudioTrackItem => ({
  id,
  name: id,
  type,
  startTime,
  duration,
  volume: 1,
  dataUrl: `blob:${id}`,
  ...parts,
});

const voice = (parts: Partial<Voice> = {}): Voice => ({
  name: 'v',
  url: 'blob:v',
  kind: 'track',
  start: 0,
  end: 10,
  sourceOffset: 0,
  speed: 1,
  loop: false,
  fade: [{ t: 0, v: 1 }],
  duck: null,
  ...parts,
});

/** A file that is in memory whole */
const wholeFile = (channels: Float32Array[], sampleRate = RATE): VoiceSource => ({
  duration: channels[0].length / sampleRate,
  read: async () => ({ channels, sampleRate, start: 0 }),
});

/** A file that hands out only the part asked for (with a little around it), as a decoder would */
const rangedFile = (channels: Float32Array[], sampleRate: number, margin = 0.02): VoiceSource & { reads: number } => {
  const source = {
    duration: channels[0].length / sampleRate,
    reads: 0,
    read: async (from: number, to: number) => {
      source.reads++;
      const a = Math.max(0, Math.floor((from - margin) * sampleRate));
      const b = Math.min(channels[0].length, Math.ceil((to + margin) * sampleRate));
      if (b <= a) return null;
      return { channels: channels.map((samples) => samples.subarray(a, b)), sampleRate, start: a / sampleRate };
    },
  };
  return source;
};

const sine = (freq: number, seconds: number, sampleRate = RATE, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));

/** Mix the voices over `seconds`, in blocks of the given lengths (the last length repeats) */
async function mix(voices: [Voice, VoiceSource][], seconds: number, blockLengths: number[]): Promise<Float32Array[]> {
  const total = Math.round(seconds * RATE);
  const result = [new Float32Array(total), new Float32Array(total)];
  const scratch = new Float32Array(Math.max(...blockLengths));
  let from = 0;
  for (let b = 0; from < total; b++) {
    const length = Math.min(total - from, blockLengths[Math.min(b, blockLengths.length - 1)]);
    const block = [new Float32Array(length), new Float32Array(length)];
    for (const [v, source] of voices) await mixVoice(block, from, v, source, scratch);
    result[0].set(block[0], from);
    result[1].set(block[1], from);
    from += length;
  }
  return result;
}

/** Largest difference between two sounds */
function maxDifference(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('volume curves', () => {
  it('fades in from silence and out to silence, at the volume in between', () => {
    const fade = fadeEnvelope(10, 20, 0.8, 2, 4);
    expect(envelopeValueAt(fade, 10)).toBe(0);
    expect(envelopeValueAt(fade, 11)).toBeCloseTo(0.4);
    expect(envelopeValueAt(fade, 12)).toBeCloseTo(0.8);
    expect(envelopeValueAt(fade, 15)).toBeCloseTo(0.8);
    expect(envelopeValueAt(fade, 18)).toBeCloseTo(0.4);
    expect(envelopeValueAt(fade, 20)).toBe(0);
  });

  it('starts at full volume when there is no fade-in, and never fades out before the fade-in is over', () => {
    expect(envelopeValueAt(fadeEnvelope(0, 5, 0.5, 0, 0), 0)).toBe(0.5);
    expect(envelopeValueAt(fadeEnvelope(0, 5, 0.5, 0, 0), 4.99)).toBe(0.5);
    // A 1 s sound with 2 s fades: up for the whole second, then cut
    const short = fadeEnvelope(0, 1, 1, 2, 2);
    expect(envelopeValueAt(short, 0.5)).toBeCloseTo(0.5);
    expect(envelopeValueAt(short, 0.99)).toBeCloseTo(0.99);
  });

  it('ducks along the same curve the preview follows (speech close together counts as one stretch)', () => {
    const speech: [number, number][] = [[0, 2], [5, 8], [8.3, 9], [20, 21]];
    const duck = duckEnvelope(speech, 0.2, 0.5);
    for (let t = 0; t < 23; t += 0.05) {
      expect(envelopeValueAt(duck, t), `at ${t.toFixed(2)} s`).toBeCloseTo(duckGainAt(mergeSpans(speech, 1), t, 0.2, 0.5), 5);
    }
  });

  it('writes the same values for a sample wherever the block starts', () => {
    const fade = fadeEnvelope(0.5, 3, 0.7, 0.4, 1);
    const duck = duckEnvelope([[1, 1.5]], 0.25, 0.2);
    const whole = new Float32Array(4 * RATE);
    writeEnvelope(whole, fade, 0);
    writeEnvelope(whole, duck, 0, true);
    expect(whole[RATE]).toBeCloseTo(0.7 * 0.25, 6);
    expect(whole[Math.round(0.7 * RATE)]).toBeCloseTo(0.35, 4);

    const from = 51234;
    const part = new Float32Array(70000);
    writeEnvelope(part, fade, from);
    writeEnvelope(part, duck, from, true);
    for (let i = 0; i < part.length; i += 7) expect(part[i]).toBe(whole[from + i]);
  });
});

describe('planSoundtrack', () => {
  it('lists the sounds that are heard, with BGM looping and ducking under the narration', () => {
    const project = makeProject({
      duration: 30,
      audioTracks: [
        track('bgm', 'bgm', 0, 40, { volume: 0.6, trimStart: 3 }),
        track('voice', 'narration', 5, 4),
        track('wind', 'ambience', 2, 10, { volume: 2, fadeInSec: 0, fadeOutSec: 0 }),
        track('nofile', 'narration', 12, 3, { dataUrl: undefined }),
      ],
    });
    const [bgm, narration, wind, ...rest] = planSoundtrack(project, 30);
    expect(rest).toEqual([]);

    expect(bgm).toMatchObject({ kind: 'track', start: 0, end: 30, sourceOffset: 3, loop: true, speed: 1 });
    expect(envelopeValueAt(bgm.fade, 0)).toBe(0);
    expect(envelopeValueAt(bgm.fade, 1.5)).toBeCloseTo(0.6);
    expect(envelopeValueAt(bgm.fade, 29)).toBeCloseTo(0.3); // half way through the 2 s fade-out
    expect(envelopeValueAt(bgm.duck!, 7)).toBeCloseTo(0.22);
    expect(envelopeValueAt(bgm.duck!, 12)).toBe(1);

    expect(narration).toMatchObject({ start: 5, end: 9, loop: false, duck: null });
    expect(envelopeValueAt(narration.fade, 7)).toBe(1);
    expect(wind).toMatchObject({ loop: true, duck: null });
    expect(envelopeValueAt(wind.fade, 2), 'volume is never above 1').toBe(1);
  });

  it('leaves muted tracks out, and does not duck under a muted narration', () => {
    const audioTracks = [track('bgm', 'bgm', 0, 20), track('voice', 'narration', 5, 4)];
    const voices = planSoundtrack(makeProject({ duration: 20, audioTracks, mutedTracks: { narration: true } }), 20);
    expect(voices.map((v) => v.name)).toEqual(['bgm']);
    expect(voices[0].duck).toBeNull();
    expect(planSoundtrack(makeProject({ duration: 20, audioTracks, mutedTracks: { bgm: true } }), 20).map((v) => v.name)).toEqual(['voice']);
  });

  it('plays the sound of video clips from the right second of the file, at the clip speed', () => {
    const clip = (id: string, parts: Partial<VideoClipItem>): VideoClipItem => ({
      id,
      name: id,
      type: 'video',
      dataUrl: `blob:${id}`,
      startTime: 3,
      duration: 6,
      trimStart: 10,
      trimEnd: 16,
      ...parts,
    });
    const project = makeProject({
      duration: 20,
      videoClips: [
        clip('normal', {}),
        clip('fast', { startTime: 9, duration: 3, trimStart: 4, trimEnd: 10, speed: 2 }),
        clip('silent', { startTime: 12, volume: 0 }),
        clip('photo', { startTime: 12, type: 'image' }),
      ],
    });
    const voices = planSoundtrack(project, 20);
    expect(voices.map((v) => v.name)).toEqual(['normal', 'fast']);
    expect(voices[0]).toMatchObject({ kind: 'clip', start: 3, end: 9, sourceOffset: 10, speed: 1, loop: false });
    expect(voices[1]).toMatchObject({ start: 9, end: 12, sourceOffset: 4, speed: 2 });
    expect(planSoundtrack({ ...project, mutedTracks: { video: true } }, 20)).toEqual([]);
  });

  it('stops every sound at the end of the video', () => {
    const [bgm] = planSoundtrack(makeProject({ audioTracks: [track('bgm', 'bgm', 4, 100)] }), 12);
    expect(bgm.end).toBe(12);
    expect(envelopeValueAt(bgm.fade, 12)).toBe(0);
    expect(planSoundtrack(makeProject({ audioTracks: [track('late', 'narration', 15, 3)] }), 12)).toEqual([]);
  });
});

describe('voicePieces', () => {
  it('gives the part of the voice inside the block, and the second of the file it starts from', () => {
    const v = voice({ start: 2, end: 9, sourceOffset: 1.5, speed: 2 });
    expect(voicePieces(v, null, 0, RATE)).toEqual([]);
    expect(voicePieces(v, null, RATE, 3 * RATE)).toEqual([{ from: 2 * RATE, to: 3 * RATE, sourceFrom: 1.5 }]);
    const [later] = voicePieces(v, null, 5 * RATE, 20 * RATE);
    expect(later).toMatchObject({ from: 5 * RATE, to: 9 * RATE });
    expect(later.sourceFrom).toBeCloseTo(7.5); // 3 s later at double speed
  });

  it('cuts a looped voice where its file starts again', () => {
    const v = voice({ start: 1, end: 10, sourceOffset: 0.5, loop: true });
    const pieces = voicePieces(v, 2, 0, 6 * RATE);
    expect(pieces.map((p) => [p.from / RATE, p.to / RATE])).toEqual([[1, 2.5], [2.5, 4.5], [4.5, 6]]);
    expect(pieces.map((p) => p.sourceFrom)).toEqual([0.5, 0, 0]);
    // The next block carries on in the middle of a round
    const [next] = voicePieces(v, 2, 6 * RATE, 7 * RATE);
    expect(next.sourceFrom).toBeCloseTo(1.5);
    // Without a known length it plays once
    expect(voicePieces(v, null, 0, 6 * RATE)).toHaveLength(1);
  });
});

describe('mixVoice', () => {
  it('copies a 48 kHz file sample for sample, from the right place, at the right volume', async () => {
    const file = Float32Array.from({ length: 5 * RATE }, (_, i) => i / (5 * RATE));
    const v = voice({ start: 1, end: 3, sourceOffset: 2, fade: [{ t: 0, v: 0.5 }] });
    const [left, right] = await mix([[v, wholeFile([file])]], 4, [RATE]);
    expect(left[RATE - 1]).toBe(0);
    expect(left[RATE]).toBeCloseTo(file[2 * RATE] * 0.5, 7);
    expect(left[RATE + 12345]).toBeCloseTo(file[2 * RATE + 12345] * 0.5, 7);
    expect(left[3 * RATE - 1]).toBeCloseTo(file[4 * RATE - 1] * 0.5, 7);
    expect(left[3 * RATE]).toBe(0);
    expect(maxDifference(left, right), 'a mono file is heard on both sides').toBe(0);
  });

  it('keeps left and right of a stereo file apart', async () => {
    const [left, right] = await mix([[voice({ end: 1 }), wholeFile([sine(440, 1), sine(880, 1)])]], 1, [RATE]);
    expect(maxDifference(left, sine(440, 1))).toBeLessThan(1e-7);
    expect(maxDifference(right, sine(880, 1))).toBeLessThan(1e-7);
  });

  it('starts a looped file again from its beginning, without a gap', async () => {
    const length = 30000; // 0.625 s
    const file = Float32Array.from({ length }, (_, i) => (i + 1) / length);
    const v = voice({ end: 3, sourceOffset: 0.25, loop: true });
    const [left] = await mix([[v, wholeFile([file])]], 3, [RATE]);
    for (let n = 0; n < left.length; n += 37) {
      expect(left[n], `sample ${n}`).toBeCloseTo(file[(12000 + n) % length], 6);
    }
  });

  it('stays silent after the end of a file that is not looped', async () => {
    const [left] = await mix([[voice({ end: 3 }), wholeFile([sine(440, 1)])]], 3, [RATE]);
    expect(Math.abs(left[RATE - 10])).toBeGreaterThan(0);
    expect(left.subarray(RATE).every((s) => s === 0)).toBe(true);
  });

  it('converts a 44.1 kHz file to the right pitch and length', async () => {
    const [left] = await mix([[voice({ end: 2 }), rangedFile([sine(440, 2, 44100)], 44100)]], 2, [RATE]);
    const expected = sine(440, 2);
    // The very last samples have nothing after them to curve towards
    expect(maxDifference(left.subarray(0, 2 * RATE - 8), expected.subarray(0, 2 * RATE - 8))).toBeLessThan(1e-3);
  });

  it('plays a clip at double speed twice as high and half as long', async () => {
    const v = voice({ kind: 'clip', start: 0.5, end: 1.5, sourceOffset: 1, speed: 2 });
    const [left] = await mix([[v, rangedFile([sine(300, 4)], RATE)]], 2, [RATE]);
    // File seconds 1 to 3 are heard over timeline seconds 0.5 to 1.5
    for (let n = RATE / 2; n < RATE * 1.5; n += 101) {
      const sourceSecond = 1 + ((n - RATE / 2) / RATE) * 2;
      expect(left[n]).toBeCloseTo(0.5 * Math.sin(2 * Math.PI * 300 * sourceSecond), 3);
    }
    expect(left[RATE / 2 - 1]).toBe(0);
    expect(left[RATE * 1.5]).toBe(0);
  });

  it('waits for the sound of a file whose sound begins late', async () => {
    const late: VoiceSource = {
      duration: 3,
      // The sound track only starts at second 1 of the file
      read: async () => ({ channels: [new Float32Array(2 * RATE).fill(0.25)], sampleRate: RATE, start: 1 }),
    };
    const [left] = await mix([[voice({ kind: 'clip', end: 3, sourceOffset: 0.5 }), late]], 3, [RATE]);
    expect(left[RATE / 2 - 1]).toBe(0);
    expect(left[RATE / 2]).toBe(0.25);
  });

  it('gives exactly the same mix however it is cut into blocks', async () => {
    const speech: [number, number][] = [[4, 7], [11.2, 13]];
    const bgmFile = wholeFile([sine(220, 3.7), sine(330, 3.7)]);
    const voices: [Voice, VoiceSource][] = [
      [
        voice({ end: 15, sourceOffset: 1.234567, loop: true, fade: fadeEnvelope(0, 15, 0.6, 1.5, 2), duck: duckEnvelope(speech, 0.22, 0.35) }),
        bgmFile,
      ],
      [voice({ start: 4, end: 7, fade: fadeEnvelope(4, 7, 1, 0.05, 0.1) }), wholeFile([sine(500, 3)])],
      [voice({ start: 11.2, end: 13, sourceOffset: 0.3, fade: fadeEnvelope(11.2, 13, 0.9, 0.05, 0.1) }), wholeFile([sine(700, 5)])],
    ];
    const whole = await mix(voices, 15, [15 * RATE]);
    for (const lengths of [[10 * RATE], [RATE], [33333, 100001, 7, 480000]]) {
      const cut = await mix(voices, 15, lengths);
      expect(maxDifference(cut[0], whole[0]), `left, blocks of ${lengths}`).toBe(0);
      expect(maxDifference(cut[1], whole[1]), `right, blocks of ${lengths}`).toBe(0);
    }
    // Something is actually in there, also across the cuts at 10 s
    expect(Math.abs(whole[0][10 * RATE + 5])).toBeGreaterThan(0.01);
  });

  it('joins the blocks without a click when the file is decoded a part at a time (other rate, other speed, looped)', async () => {
    const music = rangedFile([sine(200, 6.3, 44100), sine(310, 6.3, 44100)], 44100);
    const clipSound = rangedFile([sine(450, 30, 44100)], 44100);
    const voices: [Voice, VoiceSource][] = [
      [voice({ end: 25, sourceOffset: 0.777, loop: true, fade: fadeEnvelope(0, 25, 0.5, 1, 1) }), music],
      [voice({ kind: 'clip', start: 2.5, end: 22, sourceOffset: 1.3, speed: 1.25, fade: fadeEnvelope(2.5, 22, 0.8, 0.5, 0.5) }), clipSound],
    ];
    const whole = await mix(voices, 25, [25 * RATE]);
    const readsForWhole = music.reads;
    const cut = await mix(voices, 25, [10 * RATE]);
    expect(music.reads - readsForWhole, 'each block reads only its own part').toBeGreaterThan(4);
    // The same sound to within rounding, so nothing jumps where the blocks meet
    expect(maxDifference(cut[0], whole[0])).toBeLessThan(1e-5);
    expect(maxDifference(cut[1], whole[1])).toBeLessThan(1e-5);
    // No step between neighbouring samples at the cuts beyond what the tones themselves do
    for (const at of [10 * RATE, 20 * RATE]) {
      expect(Math.abs(cut[0][at] - cut[0][at - 1])).toBeLessThan(0.05);
    }
  });
});

describe('addPiece', () => {
  it('only touches the samples the piece and the block share', () => {
    const out = [new Float32Array(100), new Float32Array(100)];
    const gain = new Float32Array(100).fill(1);
    const sound = { channels: [new Float32Array(1000).fill(1)], sampleRate: RATE, start: 0 };
    addPiece(out, 1000, { from: 1050, to: 2000, sourceFrom: 0 }, 1, sound, gain);
    expect(out[0][49]).toBe(0);
    expect(out[0][50]).toBe(1);
    expect(out[1][99]).toBe(1);
  });
});

describe('downmixToStereo', () => {
  it('leaves mono and stereo as they are', () => {
    const mono = [Float32Array.from([1, 2])];
    expect(downmixToStereo(mono)).toBe(mono);
  });

  it('shares the centre and the surrounds of 5.1 between both sides, and leaves the bass channel out', () => {
    const channel = (v: number) => Float32Array.from([v]);
    const [left, right] = downmixToStereo([channel(0.1), channel(0.2), channel(0.4), channel(9), channel(0.01), channel(0.02)]);
    expect(left[0]).toBeCloseTo(0.1 + Math.SQRT1_2 * 0.41);
    expect(right[0]).toBeCloseTo(0.2 + Math.SQRT1_2 * 0.42);
  });
});
