import { Reader, cString } from "./reader.ts";

/** One file stored inside a LOD or SND archive. */
export interface ArchiveEntry {
  /** Lowercased name including extension, e.g. "cpkman.def". */
  name: string;
  offset: number;
  size: number;
  /** Compressed (zlib) size; 0 when stored uncompressed. */
  compressedSize: number;
}

export const LOD_HEADER_SIZE = 92;
export const LOD_ENTRY_SIZE = 32;

/** Number of entries, read from the first 12 bytes of a LOD file. */
export function lodEntryCount(header: Uint8Array): number {
  const r = new Reader(header);
  if (r.u32() !== 0x00444f4c) throw new Error("not a LOD archive");
  r.skip(4);
  return r.u32();
}

/** Parses the entry table that starts at LOD_HEADER_SIZE. */
export function parseLodEntries(table: Uint8Array, count: number): ArchiveEntry[] {
  const r = new Reader(table);
  const out: ArchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    const name = r.fixedString(16).toLowerCase();
    const offset = r.u32();
    const size = r.u32();
    r.skip(4); // type
    const compressedSize = r.u32();
    if (name) out.push({ name, offset, size, compressedSize });
  }
  return out;
}

export const SND_ENTRY_SIZE = 48;

/** SND archives: u32 count, then 48-byte entries (40-byte "name\0ext" field, offset, size). */
export function parseSndEntries(table: Uint8Array, count: number): ArchiveEntry[] {
  const r = new Reader(table);
  const out: ArchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    const field = r.slice(40);
    const offset = r.u32();
    const size = r.u32();
    const base = cString(field);
    // The extension field isn't always cleanly terminated ("WAVvvWAV"); it's always 3 chars.
    const ext = cString(field.subarray(base.length + 1)).slice(0, 3) || "wav";
    out.push({ name: `${base}.${ext}`.toLowerCase(), offset, size, compressedSize: 0 });
  }
  return out;
}

/**
 * HotA 1.7+'s own archive (HotA.lod) has a table laid out unlike the original's LODs; the game
 * recognises it by this check and leaves it alone (its contents come from elsewhere).
 */
export function hotaLodKey(header: Uint8Array, firstRow: Uint8Array, count: number): number | undefined {
  if (header.length < 16 || firstRow.length < 16) return undefined;
  const h = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const r = new DataView(firstRow.buffer, firstRow.byteOffset, firstRow.byteLength);
  const key = h.getUint32(12, true);
  if (!key) return undefined;
  return (r.getUint32(4, true) ^ key) >>> 0 === LOD_HEADER_SIZE + count * LOD_ENTRY_SIZE ? key : undefined;
}

