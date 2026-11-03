/** Little-endian cursor over a byte buffer. */
export class Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  u8(): number {
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  skip(n: number): void {
    this.pos += n;
  }

  slice(n: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Fixed-size, zero-padded ASCII field. */
  fixedString(n: number): string {
    return cString(this.slice(n));
  }

  /** u32 length-prefixed string (H3M style). */
  lenString(): string {
    const len = this.u32();
    return decodeText(this.slice(len));
  }
}

export function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return decodeText(end < 0 ? bytes : bytes.subarray(0, end));
}

const latin = new TextDecoder("windows-1252");
const utf8 = new TextDecoder("utf-8");

/**
 * Game text is single-byte codepage; the English release is windows-1252. A text behind a UTF-8 byte order mark
 * is UTF-8: another release's text file the page has read in its own code page (the client's releaseText).
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3));
  return latin.decode(bytes);
}
