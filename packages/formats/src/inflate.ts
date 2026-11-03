// A small synchronous DEFLATE decoder (after tinf) that reports how much input it used, so a
// file of several gzip members (an .h3c campaign: header + one map per scenario) can be split.

class Bits {
  pos: number;
  bit = 0;
  count = 0;
  readonly data: Uint8Array;
  constructor(data: Uint8Array, pos: number) {
    this.data = data;
    this.pos = pos;
  }
  read(n: number): number {
    while (this.count < n) {
      if (this.pos >= this.data.length) throw new Error("inflate: out of data");
      this.bit |= this.data[this.pos++] << this.count;
      this.count += 8;
    }
    const v = this.bit & ((1 << n) - 1);
    this.bit >>>= n;
    this.count -= n;
    return v;
  }
  /** Drops the bits left in the current byte (stored blocks start byte-aligned). */
  align() {
    this.bit = 0;
    this.count = 0;
  }
}

interface Tree {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildTree(lengths: Uint8Array, offset: number, n: number): Tree {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) counts[lengths[offset + i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1, sum = 0; i < 16; i++) {
    offs[i] = sum;
    sum += counts[i];
  }
  for (let i = 0; i < n; i++) if (lengths[offset + i]) symbols[offs[lengths[offset + i]]++] = i;
  return { counts, symbols };
}

function decodeSymbol(b: Bits, t: Tree): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len < 16; len++) {
    code |= b.read(1);
    const count = t.counts[len];
    if (code - first < count) return t.symbols[index + code - first];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error("inflate: bad code");
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixed: { lit: Tree; dist: Tree } | null = null;
function fixedTrees() {
  if (fixed) return fixed;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  fixed = { lit: buildTree(l, 0, 288), dist: buildTree(d, 0, 30) };
  return fixed;
}

/** Inflates raw DEFLATE data starting at `start`; returns the output and where the input ended. */
export function inflateRaw(data: Uint8Array, start = 0): { out: Uint8Array; end: number } {
  const b = new Bits(data, start);
  let out = new Uint8Array(1 << 16);
  let len = 0;
  const grow = (n: number) => {
    if (len + n <= out.length) return;
    let size = out.length * 2;
    while (size < len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(out.subarray(0, len));
    out = next;
  };
  let last = 0;
  while (!last) {
    last = b.read(1);
    const type = b.read(2);
    if (type === 0) {
      b.align();
      const n = data[b.pos] | (data[b.pos + 1] << 8);
      b.pos += 4;
      grow(n);
      out.set(data.subarray(b.pos, b.pos + n), len);
      len += n;
      b.pos += n;
      continue;
    }
    let lit: Tree;
    let dist: Tree;
    if (type === 1) ({ lit, dist } = fixedTrees());
    else if (type === 2) {
      const hlit = b.read(5) + 257;
      const hdist = b.read(5) + 1;
      const hclen = b.read(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CLEN_ORDER[i]] = b.read(3);
      const clTree = buildTree(cl, 0, 19);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist; ) {
        const sym = decodeSymbol(b, clTree);
        if (sym < 16) lengths[i++] = sym;
        else {
          let rep = 0;
          let val = 0;
          if (sym === 16) [val, rep] = [lengths[i - 1], 3 + b.read(2)];
          else if (sym === 17) rep = 3 + b.read(3);
          else rep = 11 + b.read(7);
          while (rep--) lengths[i++] = val;
        }
      }
      lit = buildTree(lengths, 0, hlit);
      dist = buildTree(lengths, hlit, hdist);
    } else throw new Error("inflate: bad block type");
    for (;;) {
      const sym = decodeSymbol(b, lit);
      if (sym === 256) break;
      if (sym < 256) {
        grow(1);
        out[len++] = sym;
        continue;
      }
      const li = sym - 257;
      const length = LENGTH_BASE[li] + b.read(LENGTH_EXTRA[li]);
      const di = decodeSymbol(b, dist);
      const distance = DIST_BASE[di] + b.read(DIST_EXTRA[di]);
      grow(length);
      for (let k = 0; k < length; k++, len++) out[len] = out[len - distance];
    }
  }
  return { out: out.subarray(0, len), end: b.pos };
}

/** Every gzip member in the data, decompressed, in order. */
export function gunzipMembers(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let p = 0;
  while (p + 18 <= data.length && data[p] === 0x1f && data[p + 1] === 0x8b) {
    const flags = data[p + 3];
    let q = p + 10;
    if (flags & 4) q += 2 + (data[q] | (data[q + 1] << 8));
    if (flags & 8) while (data[q++] !== 0);
    if (flags & 16) while (data[q++] !== 0);
    if (flags & 2) q += 2;
    const { out: body, end } = inflateRaw(data, q);
    out.push(body);
    p = end + 8; // CRC32 and size
  }
  return out;
}
