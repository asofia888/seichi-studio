/**
 * Produces the exported soundtrack in blocks of a few seconds, reading from the sound and video
 * files only what each block needs. Nothing here grows with the length of the video: a block of
 * the mix, the files playing during it, and for long files just the seconds being played.
 *
 * The arithmetic is in soundtrack.ts; this file opens and decodes the files (browser only).
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { ProjectData } from '../types';
import { downmixToStereo, MIX_SAMPLE_RATE, mixVoice, planSoundtrack, SourceSound, Voice, VoiceSource } from './soundtrack';

/** Length of one block of the mix */
export const MIX_BLOCK_SEC = 10;
const BLOCK_SAMPLES = MIX_BLOCK_SEC * MIX_SAMPLE_RATE;

/**
 * Sound files up to this long are decoded whole by the browser (which also converts them to the
 * mix's sample rate with its best filter) and kept while they play: at most about 115 MB each.
 * Longer ones, and the sound of video files, are decoded a block at a time.
 */
const WHOLE_FILE_SEC = 300;
// Decoders need a moment of sound before the part that is wanted to settle in...
const PREROLL_SEC = 0.25;
// ...and smoothing between samples needs a few after it
const TAIL_SEC = 0.02;

type SourceMode = 'whole' | 'ranged';

interface OpenSource extends VoiceSource {
  close(): void;
}

/** The whole file, decoded by the browser at the mix's sample rate */
async function openWhole(url: string): Promise<OpenSource | null> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 1, MIX_SAMPLE_RATE).decodeAudioData(data);
    const sound: SourceSound = {
      channels: downmixToStereo(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))),
      sampleRate: buffer.sampleRate,
      start: 0,
    };
    return { duration: buffer.length / buffer.sampleRate, read: async () => sound, close: () => {} };
  } catch {
    return null;
  }
}

/**
 * A file whose sound is decoded only where it is asked for. Null when it has no sound track, or
 * one this browser cannot decode. `withDuration` also finds out how long the sound is (which
 * may mean scanning the file).
 */
async function openRanged(url: string, withDuration: boolean): Promise<OpenSource | null> {
  let input: Input | null = null;
  try {
    const blob = await (await fetch(url)).blob();
    input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    const first = await track.getFirstTimestamp();
    const duration = withDuration ? (await track.computeDuration()) - first : null;
    const sink = new AudioBufferSink(track);
    const opened = input;

    return {
      duration,
      async read(from, to) {
        try {
          const pieces: { buffer: AudioBuffer; at: number }[] = [];
          for await (const { buffer, timestamp } of sink.buffers(first + Math.max(0, from - PREROLL_SEC), first + to + TAIL_SEC)) {
            pieces.push({ buffer, at: timestamp - first });
          }
          if (pieces.length === 0) return null;

          // Each piece goes where its timestamp says, so a gap in the file stays a gap
          const { sampleRate } = pieces[0].buffer;
          const start = pieces[0].at;
          const position = (at: number) => Math.max(0, Math.round((at - start) * sampleRate));
          const length = Math.max(...pieces.map((p) => position(p.at) + p.buffer.length));
          const channelCount = Math.max(...pieces.map((p) => p.buffer.numberOfChannels));
          const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
          for (const { buffer, at } of pieces) {
            const offset = position(at);
            for (let c = 0; c < channelCount; c++) {
              buffer.copyFromChannel(channels[c].subarray(offset, offset + buffer.length), Math.min(c, buffer.numberOfChannels - 1));
            }
          }
          return { channels: downmixToStereo(channels), sampleRate, start };
        } catch (e) {
          console.warn('Could not decode part of a sound track:', e);
          return null;
        }
      },
      close: () => opened.dispose(),
    };
  } catch {
    input?.dispose();
    return null;
  }
}

/** How a file's sound will be read; null when it has none that can be decoded */
async function probe(url: string, kind: Voice['kind']): Promise<SourceMode | null> {
  const ranged = await openRanged(url, kind === 'track');
  if (ranged) {
    ranged.close();
    if (kind === 'clip') return 'ranged';
    return ranged.duration !== null && ranged.duration <= WHOLE_FILE_SEC ? 'whole' : 'ranged';
  }
  if (kind === 'clip') return null; // a video without a sound track is normal
  // A format only the browser's own decoder understands
  return (await openWhole(url)) ? 'whole' : null;
}

export class SoundtrackMixer {
  /** Samples in the whole soundtrack */
  readonly totalSamples: number;
  readonly blockCount: number;

  /** The files open right now: those playing in the block being produced */
  private sources = new Map<string, Promise<OpenSource | null>>();
  private scratch = new Float32Array(BLOCK_SAMPLES);
  private warned = new Set<string>();

  private constructor(
    private readonly voices: Voice[],
    private readonly modes: Map<string, SourceMode | null>,
    duration: number,
    private readonly warnings: string[]
  ) {
    this.totalSamples = Math.max(1, Math.ceil(duration * MIX_SAMPLE_RATE));
    this.blockCount = Math.ceil(this.totalSamples / BLOCK_SAMPLES);
  }

  /**
   * Look at every sound the project plays. Null when nothing can be heard (the video then gets
   * no sound track). Sound files that cannot be read are reported in `warnings` and left out.
   */
  static async open(project: ProjectData, duration: number, warnings: string[]): Promise<SoundtrackMixer | null> {
    const planned = planSoundtrack(project, duration);
    const modes = new Map<string, SourceMode | null>();
    for (const voice of planned) {
      if (!modes.has(voice.url)) modes.set(voice.url, await probe(voice.url, voice.kind));
    }
    for (const voice of planned) {
      if (voice.kind === 'track' && !modes.get(voice.url)) {
        warnings.push(`音声「${voice.name}」を読み込めなかったため、無音で書き出しました。`);
      }
    }
    const voices = planned.filter((voice) => modes.get(voice.url));
    return voices.length > 0 ? new SoundtrackMixer(voices, modes, duration, warnings) : null;
  }

  /** Block `index` of the mix: two channels of up to MIX_BLOCK_SEC, before any mastering */
  async render(index: number): Promise<Float32Array[]> {
    const from = index * BLOCK_SAMPLES;
    const length = Math.max(0, Math.min(BLOCK_SAMPLES, this.totalSamples - from));
    const out = [new Float32Array(length), new Float32Array(length)];
    const active = this.voices.filter(
      (voice) => voice.start * MIX_SAMPLE_RATE < from + length + 1 && voice.end * MIX_SAMPLE_RATE > from - 1
    );

    // Let go of the files that have finished playing
    const needed = new Set(active.map((voice) => voice.url));
    for (const [url, source] of this.sources) {
      if (needed.has(url)) continue;
      this.sources.delete(url);
      void source.then((opened) => opened?.close());
    }

    for (const voice of active) {
      const source = await this.source(voice);
      if (source) await mixVoice(out, from, voice, source, this.scratch);
    }
    return out;
  }

  /** The whole mix from the beginning, block by block. `onBlock` is called before each one. */
  async *blocks(onBlock?: (index: number) => void): AsyncGenerator<Float32Array[], void, unknown> {
    for (let index = 0; index < this.blockCount; index++) {
      onBlock?.(index);
      yield await this.render(index);
    }
  }

  private source(voice: Voice): Promise<OpenSource | null> {
    let source = this.sources.get(voice.url);
    if (!source) {
      // The file's length is needed if any of the voices playing it loops
      const loops = this.voices.some((other) => other.url === voice.url && other.loop);
      source = (async () => {
        const opened =
          this.modes.get(voice.url) === 'whole'
            ? ((await openWhole(voice.url)) ?? (await openRanged(voice.url, loops)))
            : await openRanged(voice.url, loops);
        if (!opened && !this.warned.has(voice.url)) {
          this.warned.add(voice.url);
          this.warnings.push(`「${voice.name}」の音を読み込めなかったため、その部分は無音で書き出しました。`);
        }
        return opened;
      })();
      this.sources.set(voice.url, source);
    }
    return source;
  }

  dispose(): void {
    for (const source of this.sources.values()) void source.then((opened) => opened?.close());
    this.sources.clear();
  }
}

/** Samples as an AudioBuffer, for the encoder */
export function toAudioBuffer(channels: Float32Array[]): AudioBuffer {
  const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: MIX_SAMPLE_RATE });
  channels.forEach((samples, c) => buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, c));
  return buffer;
}
