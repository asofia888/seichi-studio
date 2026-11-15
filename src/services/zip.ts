/**
 * A small ZIP writer and reader for project backups. Files go in uncompressed (photos, videos and
 * sound are compressed already) and are never loaded into memory: the archive is a Blob made of
 * the files themselves plus headers, and reading hands out slices of the archive. ZIP64 is used
 * where an archive outgrows 4 GB, which a visit's worth of video easily does.
 */

export interface ZipInput {
  /** Path inside the archive, with forward slashes */
  name: string;
  data: Blob;
}

export interface ZipEntry {
  name: string;
  /** Size of the file once unpacked (bytes) */
  size: number;
  /** The file's contents; `type` becomes the Blob's MIME type */
  blob(type?: string): Promise<Blob>;
}

export class ZipFormatError extends Error {
  constructor(message = 'ZIP ファイルとして読み込めませんでした。') {
    super(message);
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_END64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const VERSION_PLAIN = 20;
const VERSION_ZIP64 = 45;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a blob, read piece by piece. `onBytes` is told how many bytes each piece had. */
async function crc32(blob: Blob, onBytes?: (count: number) => void, signal?: AbortSignal): Promise<number> {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length; i++) crc = CRC_TABLE[(crc ^ value[i]) & 0xff] ^ (crc >>> 8);
      onBytes?.(value.length);
    }
  } finally {
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes little-endian fields one after another */
class FieldWriter {
  private view: DataView;
  private position = 0;
  constructor(public readonly bytes: Uint8Array<ArrayBuffer>) {
    this.view = new DataView(bytes.buffer);
  }
  u16(value: number) {
    this.view.setUint16(this.position, value, true);
    this.position += 2;
  }
  u32(value: number) {
    this.view.setUint32(this.position, value, true);
    this.position += 4;
  }
  u64(value: number) {
    this.view.setBigUint64(this.position, BigInt(value), true);
    this.position += 8;
  }
  raw(data: Uint8Array) {
    this.bytes.set(data, this.position);
    this.position += data.length;
  }
}

const writer = (length: number) => new FieldWriter(new Uint8Array(length));

/** MS-DOS date and time, as ZIP headers store them */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface BuildZipOptions {
  /** Called with the bytes read so far and the total, while the files are being checksummed */
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /** 'always' writes ZIP64 records even for a small archive (for tests) */
  zip64?: 'auto' | 'always';
}

/** An archive holding `files`. Each file is read once, for its checksum; none is copied. */
export async function buildZip(files: ZipInput[], options: BuildZipOptions = {}): Promise<Blob> {
  const forceZip64 = options.zip64 === 'always';
  const totalBytes = files.reduce((sum, f) => sum + f.data.size, 0);
  let doneBytes = 0;
  const stamp = dosDateTime(new Date());
  const encoder = new TextEncoder();

  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const size = file.data.size;
    const crc = await crc32(
      file.data,
      (count) => {
        doneBytes += count;
        options.onProgress?.(doneBytes, totalBytes);
      },
      options.signal
    );

    // Local header: a ZIP64 extra field carries the sizes when they do not fit in 32 bits
    const bigSize = forceZip64 || size >= MAX_32;
    const local = writer(30 + name.length + (bigSize ? 20 : 0));
    local.u32(SIG_LOCAL);
    local.u16(bigSize ? VERSION_ZIP64 : VERSION_PLAIN);
    local.u16(FLAG_UTF8_NAMES);
    local.u16(METHOD_STORED);
    local.u16(stamp.time);
    local.u16(stamp.date);
    local.u32(crc);
    local.u32(bigSize ? MAX_32 : size);
    local.u32(bigSize ? MAX_32 : size);
    local.u16(name.length);
    local.u16(bigSize ? 20 : 0);
    local.raw(name);
    if (bigSize) {
      local.u16(ZIP64_EXTRA_ID);
      local.u16(16);
      local.u64(size);
      local.u64(size);
    }

    // Central directory entry: its ZIP64 extra field holds only the values that did not fit
    const bigOffset = forceZip64 || offset >= MAX_32;
    const extraLength = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
    const entry = writer(46 + name.length + (extraLength ? 4 + extraLength : 0));
    entry.u32(SIG_CENTRAL);
    entry.u16(extraLength ? VERSION_ZIP64 : VERSION_PLAIN);
    entry.u16(extraLength ? VERSION_ZIP64 : VERSION_PLAIN);
    entry.u16(FLAG_UTF8_NAMES);
    entry.u16(METHOD_STORED);
    entry.u16(stamp.time);
    entry.u16(stamp.date);
    entry.u32(crc);
    entry.u32(bigSize ? MAX_32 : size);
    entry.u32(bigSize ? MAX_32 : size);
    entry.u16(name.length);
    entry.u16(extraLength ? 4 + extraLength : 0);
    entry.u16(0); // comment length
    entry.u16(0); // disk number
    entry.u16(0); // internal attributes
    entry.u32(0); // external attributes
    entry.u32(bigOffset ? MAX_32 : offset);
    entry.raw(name);
    if (extraLength) {
      entry.u16(ZIP64_EXTRA_ID);
      entry.u16(extraLength);
      if (bigSize) {
        entry.u64(size);
        entry.u64(size);
      }
      if (bigOffset) entry.u64(offset);
    }

    parts.push(local.bytes, file.data);
    central.push(entry.bytes);
    offset += local.bytes.length + size;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  parts.push(...central);

  const needsZip64 = forceZip64 || files.length >= MAX_16 || centralOffset >= MAX_32 || centralSize >= MAX_32;
  if (needsZip64) {
    const end64 = writer(56 + 20);
    end64.u32(SIG_END64);
    end64.u64(44); // size of the rest of this record
    end64.u16(VERSION_ZIP64);
    end64.u16(VERSION_ZIP64);
    end64.u32(0); // this disk
    end64.u32(0); // disk with the central directory
    end64.u64(files.length);
    end64.u64(files.length);
    end64.u64(centralSize);
    end64.u64(centralOffset);
    end64.u32(SIG_END64_LOCATOR);
    end64.u32(0); // disk with the ZIP64 end record
    end64.u64(centralOffset + centralSize);
    end64.u32(1); // number of disks
    parts.push(end64.bytes);
  }

  const end = writer(22);
  end.u32(SIG_END);
  end.u16(0);
  end.u16(0);
  end.u16(Math.min(files.length, MAX_16));
  end.u16(Math.min(files.length, MAX_16));
  end.u32(Math.min(centralSize, MAX_32));
  end.u32(Math.min(centralOffset, MAX_32));
  end.u16(0);
  parts.push(end.bytes);

  return new Blob(parts, { type: 'application/zip' });
}

const viewOf = async (blob: Blob) => new DataView(await blob.arrayBuffer());

// The end record is the last thing in the file, after at most a 65535-byte comment
const END_SEARCH_BYTES = 22 + MAX_16;

/** Unpack data stored with DEFLATE (archives made, or re-packed, by other programs) */
async function inflate(data: Blob, type?: string): Promise<Blob> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipFormatError('このブラウザでは、圧縮された ZIP ファイルを読み込めません。');
  }
  const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const unpacked = await new Response(stream).blob();
  return type ? new Blob([unpacked], { type }) : unpacked;
}

/** The files in an archive. Nothing is read from a file until its `blob()` is asked for. */
export async function readZip(archive: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, archive.size - END_SEARCH_BYTES);
  const tail = await viewOf(archive.slice(tailStart));
  let endAt = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_END) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new ZipFormatError();

  let count = tail.getUint16(endAt + 10, true);
  let centralSize = tail.getUint32(endAt + 12, true);
  let centralOffset = tail.getUint32(endAt + 16, true);

  // A ZIP64 archive keeps the real numbers in its own end record, pointed to from just before this one
  if (endAt >= 20 && tail.getUint32(endAt - 20, true) === SIG_END64_LOCATOR) {
    const end64Offset = Number(tail.getBigUint64(endAt - 20 + 8, true));
    const end64 = await viewOf(archive.slice(end64Offset, end64Offset + 56));
    if (end64.byteLength < 56 || end64.getUint32(0, true) !== SIG_END64) throw new ZipFormatError();
    count = Number(end64.getBigUint64(32, true));
    centralSize = Number(end64.getBigUint64(40, true));
    centralOffset = Number(end64.getBigUint64(48, true));
  }
  if (centralOffset + centralSize > archive.size) throw new ZipFormatError();

  const directory = await viewOf(archive.slice(centralOffset, centralOffset + centralSize));
  const utf8 = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== SIG_CENTRAL) throw new ZipFormatError();
    const flags = directory.getUint16(at + 8, true);
    const method = directory.getUint16(at + 10, true);
    let packedSize = directory.getUint32(at + 20, true);
    let size = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let localOffset = directory.getUint32(at + 42, true);
    const nameStart = at + 46;
    const name = utf8.decode(new Uint8Array(directory.buffer, directory.byteOffset + nameStart, nameLength));

    // ZIP64 extra field: the values whose 32-bit place is filled with 0xFFFFFFFF, in this order
    let extraAt = nameStart + nameLength;
    const extraEnd = extraAt + extraLength;
    while (extraAt + 4 <= extraEnd) {
      const id = directory.getUint16(extraAt, true);
      const length = directory.getUint16(extraAt + 2, true);
      if (id === ZIP64_EXTRA_ID) {
        let field = extraAt + 4;
        const next = () => {
          const value = Number(directory.getBigUint64(field, true));
          field += 8;
          return value;
        };
        if (size === MAX_32) size = next();
        if (packedSize === MAX_32) packedSize = next();
        if (localOffset === MAX_32) localOffset = next();
      }
      extraAt += 4 + length;
    }
    at = extraEnd + commentLength;

    if (name.endsWith('/')) continue; // a folder
    const entrySize = size;
    const entryPackedSize = packedSize;
    const entryOffset = localOffset;
    entries.push({
      name,
      size: entrySize,
      blob: async (type?: string) => {
        if (flags & FLAG_ENCRYPTED) throw new ZipFormatError('パスワード付きの ZIP ファイルは読み込めません。');
        const local = await viewOf(archive.slice(entryOffset, entryOffset + 30));
        if (local.byteLength < 30 || local.getUint32(0, true) !== SIG_LOCAL) throw new ZipFormatError();
        const dataStart = entryOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        if (dataStart + entryPackedSize > archive.size) throw new ZipFormatError();
        const data = archive.slice(dataStart, dataStart + entryPackedSize, type);
        if (method === METHOD_STORED) return data;
        if (method === METHOD_DEFLATED) return inflate(data, type);
        throw new ZipFormatError('この ZIP ファイルの圧縮形式には対応していません。');
      },
    });
  }
  return entries;
}
