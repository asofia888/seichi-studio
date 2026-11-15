import { describe, expect, it } from 'vitest';
import { buildZip, readZip, ZipFormatError } from './zip';

const text = (s: string, type = 'text/plain') => new Blob([s], { type });

const FILES = [
  { name: 'backup.json', data: text('{"title":"戸隠神社"}', 'application/json') },
  { name: 'media/001_参道の杉並木.mp4', data: text('video bytes '.repeat(1000), 'video/mp4') },
  { name: 'media/002_empty.bin', data: new Blob([]) },
];

describe('buildZip / readZip', () => {
  for (const zip64 of ['auto', 'always'] as const) {
    it(`gives back the same files (${zip64 === 'always' ? 'ZIP64, as for archives over 4 GB' : 'plain'})`, async () => {
      const archive = await buildZip(FILES, { zip64 });
      const entries = await readZip(archive);

      expect(entries.map((e) => e.name)).toEqual(FILES.map((f) => f.name));
      expect(entries.map((e) => e.size)).toEqual(FILES.map((f) => f.data.size));
      for (const [i, entry] of entries.entries()) {
        expect(await (await entry.blob()).text()).toBe(await FILES[i].data.text());
      }
      expect((await entries[1].blob('video/mp4')).type).toBe('video/mp4');
    });
  }

  it('does not copy the files: the archive is only headers larger than what it holds', async () => {
    const archive = await buildZip(FILES);
    const payload = FILES.reduce((sum, f) => sum + f.data.size, 0);
    expect(archive.size).toBeGreaterThan(payload);
    expect(archive.size).toBeLessThan(payload + 1000);
  });

  it('reports how far the files have been read', async () => {
    const seen: number[] = [];
    let total = 0;
    await buildZip(FILES, { onProgress: (done, all) => (seen.push(done), (total = all)) });
    expect(total).toBe(FILES.reduce((sum, f) => sum + f.data.size, 0));
    expect(seen[seen.length - 1]).toBe(total);
  });

  it('stops when canceled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(buildZip(FILES, { signal: abort.signal })).rejects.toThrow();
  });

  it('refuses a file that is not a ZIP archive', async () => {
    await expect(readZip(text('just some text'))).rejects.toThrow(ZipFormatError);
    await expect(readZip(new Blob([]))).rejects.toThrow(ZipFormatError);
  });

  it('refuses an archive cut short (e.g. a download that did not finish)', async () => {
    const archive = await buildZip(FILES);
    await expect(readZip(archive.slice(0, archive.size - 40))).rejects.toThrow(ZipFormatError);
  });
});
