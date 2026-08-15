/**
 * A self-contained ZIP layer, because DOCX, EPUB and the Manu project archive
 * are all ZIP containers.
 *
 * Reading understands the two methods real documents use: `stored` and
 * `deflate`. Decompression is pluggable — Node supplies `zlib`, the browser
 * supplies `DecompressionStream` — so this package needs no dependency and no
 * environment assumption. Writing always uses `stored`: every consumer of our
 * output (Word, ebook readers, Manu itself) accepts it, and a manuscript is
 * small enough that correctness beats compression.
 */

/** Decompress raw-deflate bytes. Supplied by the host environment. */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** `DecompressionStream`-based inflate for browsers (and modern Node). */
export async function streamInflate(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  // Structural cast: Node's and the DOM's stream typings disagree about the
  // Uint8Array flavour, while the runtime objects are identical.
  const inflater = new DecompressionStream("deflate-raw") as unknown as {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
  const stream = source.pipeThrough(inflater);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

/** Read every entry of a ZIP archive. Throws on structures we cannot honour. */
export async function readZip(bytes: Uint8Array, inflate: Inflate): Promise<ZipEntry[]> {
  // Find the end-of-central-directory record, scanning back past any comment.
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 65557);
  for (let index = bytes.length - 22; index >= earliest; index -= 1) {
    if (u32(bytes, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a ZIP archive (no end-of-central-directory record).");

  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (u32(bytes, offset) !== 0x02014b50) {
      throw new Error("Corrupt ZIP central directory.");
    }
    const method = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    // The local header carries its own (possibly different) name/extra sizes.
    if (u32(bytes, localOffset) !== 0x04034b50) {
      throw new Error(`Corrupt ZIP local header for "${name}".`);
    }
    const localName = u16(bytes, localOffset + 26);
    const localExtra = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localName + localExtra;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (!name.endsWith("/")) {
      if (method === 0) {
        entries.push({ name, data: raw.slice() });
      } else if (method === 8) {
        entries.push({ name, data: await inflate(raw) });
      } else {
        throw new Error(`"${name}" uses unsupported ZIP compression method ${method}.`);
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pushU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

/**
 * Write a ZIP archive with every entry stored (method 0), in the given order.
 * Order matters to one consumer: EPUB requires `mimetype` first and stored,
 * which this writer satisfies by construction.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const localOffset = out.length;

    pushU32(out, 0x04034b50);
    pushU16(out, 20); // Version needed.
    pushU16(out, 0); // Flags.
    pushU16(out, 0); // Method: stored.
    pushU16(out, 0); // Time.
    pushU16(out, 0x21); // Date (a valid constant date).
    pushU32(out, checksum);
    pushU32(out, entry.data.length);
    pushU32(out, entry.data.length);
    pushU16(out, nameBytes.length);
    pushU16(out, 0); // Extra length.
    for (const byte of nameBytes) out.push(byte);
    for (const byte of entry.data) out.push(byte);

    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0x21);
    pushU32(central, checksum);
    pushU32(central, entry.data.length);
    pushU32(central, entry.data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, localOffset);
    for (const byte of nameBytes) central.push(byte);
  }

  const centralOffset = out.length;
  for (const byte of central) out.push(byte);
  pushU32(out, 0x06054b50);
  pushU16(out, 0);
  pushU16(out, 0);
  pushU16(out, entries.length);
  pushU16(out, entries.length);
  pushU32(out, central.length);
  pushU32(out, centralOffset);
  pushU16(out, 0);

  return Uint8Array.from(out);
}
