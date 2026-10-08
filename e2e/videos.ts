/**
 * Short test videos, encoded in the browser with mediabunny: a coloured picture, a sound that is
 * quiet or voice-like, and the recording time and place where an Android phone writes them
 */
import { readFileSync } from 'node:fs';
import type { Browser } from '@playwright/test';

export interface TestVideo {
  name: string;
  seconds: number;
  color: string;
  /** Seconds where a voice-like sound plays (otherwise only faint noise) */
  speech?: [number, number];
  /** Kept as the creation time in the movie header, like Android phones do */
  recordedAt: string;
  /** ISO 6709 in the ©xyz tag, like Android phones do */
  location?: string;
}

const ORIGIN = 'https://fixtures.test';
// The library's single-file build, as installed for the app
const mediabunnyBundle = () => readFileSync(new URL('../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', import.meta.url));

export async function makeVideos(browser: Browser, videos: TestVideo[]): Promise<{ name: string; mimeType: string; buffer: Buffer }[]> {
  const page = await browser.newPage();
  try {
    // A secure page of its own (WebCodecs needs one) that can load the library from the same origin
    await page.route(`${ORIGIN}/**`, (route) =>
      route.request().url().endsWith('.mjs')
        ? route.fulfill({ contentType: 'text/javascript', body: mediabunnyBundle() })
        : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fixtures</title>' })
    );
    await page.goto(`${ORIGIN}/`);
    const encoded = await page.evaluate(
      async ({ url, videos }) => {
        const mb = await import(url);
        const results: string[] = [];
        for (const v of videos) {
          const canvas = new OffscreenCanvas(320, 180);
          const ctx = canvas.getContext('2d')!;
          const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
          const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 1_000_000 });
          const audio = new mb.AudioBufferSource({ codec: 'opus', bitrate: 96_000 });
          output.addVideoTrack(video, { frameRate: 30 });
          output.addAudioTrack(audio);
          if (v.location) output.setMetadataTags({ raw: { '©xyz': v.location } });
          await output.start();

          // Faint noise, and a voice-like sound: a 140 Hz buzz with harmonics, rising and falling like syllables
          const rate = 48000;
          const sound = new AudioBuffer({ length: v.seconds * rate, numberOfChannels: 1, sampleRate: rate });
          const samples = sound.getChannelData(0);
          for (let i = 0; i < samples.length; i++) {
            const t = i / rate;
            let x = (Math.random() * 2 - 1) * 0.002;
            if (v.speech && t >= v.speech[0] && t < v.speech[1]) {
              const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * t);
              for (let k = 1; k <= 8; k++) x += (0.25 / k) * syllable * Math.sin(2 * Math.PI * 140 * k * t);
            }
            samples[i] = x;
          }
          await audio.add(sound);
          audio.close();

          // A still, detailed picture (stripes), so it counts as steady and sharp
          for (let f = 0; f < v.seconds * 30; f++) {
            ctx.fillStyle = v.color;
            ctx.fillRect(0, 0, 320, 180);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            for (let x = 0; x < 320; x += 16) ctx.fillRect(x, 0, 8, 180);
            await video.add(f / 30, 1 / 30);
          }
          await output.finalize();

          const bytes = new Uint8Array(output.target.buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          results.push(btoa(binary));
        }
        return results;
      },
      { url: `${ORIGIN}/mediabunny.mjs`, videos }
    );
    return videos.map((v, i) => {
      const buffer = Buffer.from(encoded[i], 'base64');
      setCreationTime(buffer, new Date(v.recordedAt));
      return { name: v.name, mimeType: 'video/mp4', buffer };
    });
  } finally {
    await page.close();
  }
}

/** Write `date` into the movie header (moov/mvhd), where mediabunny puts the time the file was made */
function setCreationTime(mp4: Buffer, date: Date) {
  const find = (type: string, start: number, end: number) => {
    for (let pos = start; pos + 8 <= end; ) {
      const size = mp4.readUInt32BE(pos);
      if (mp4.toString('latin1', pos + 4, pos + 8) === type) return { start: pos + 8, end: pos + size };
      if (size < 8) break;
      pos += size;
    }
    throw new Error(`${type} box not found`);
  };
  const moov = find('moov', 0, mp4.length);
  const mvhd = find('mvhd', moov.start, moov.end);
  const seconds = Math.round(date.getTime() / 1000) + 2082844800; // since 1904, the MP4 epoch
  if (mp4[mvhd.start] === 1) {
    mp4.writeBigUInt64BE(BigInt(seconds), mvhd.start + 4); // creation
    mp4.writeBigUInt64BE(BigInt(seconds), mvhd.start + 12); // modification
  } else {
    mp4.writeUInt32BE(seconds, mvhd.start + 4);
    mp4.writeUInt32BE(seconds, mvhd.start + 8);
  }
}
