import { Reader } from "./reader.ts";

export interface Pcm {
  sampleRate: number;
  channels: number;
  /** One Float32Array per channel, samples in -1..1. */
  data: Float32Array[];
}

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/**
 * Decodes a WAV to float samples. Handles plain PCM and the IMA ADPCM
 * (format 0x11) the game's sound effects use, which browsers can't decode.
 */
export function decodeWav(bytes: Uint8Array): Pcm {
  const r = new Reader(bytes);
  if (r.fixedString(4) !== "RIFF") throw new Error("not a WAV");
  r.skip(4);
  if (r.fixedString(4) !== "WAVE") throw new Error("not a WAV");
  let format = 1;
  let channels = 1;
  let sampleRate = 22050;
  let bits = 16;
  let blockAlign = 0;
  let samplesPerBlock = 0;
  let data: Uint8Array | null = null;
  while (r.remaining >= 8) {
    const id = r.fixedString(4);
    const size = r.u32();
    const start = r.pos;
    if (id === "fmt ") {
      format = r.u16();
      channels = r.u16();
      sampleRate = r.u32();
      r.skip(4);
      blockAlign = r.u16();
      bits = r.u16();
      if (size > 16) {
        const extra = r.u16();
        if (extra >= 2) samplesPerBlock = r.u16();
      }
    } else if (id === "data") {
      data = bytes.subarray(start, Math.min(bytes.length, start + size));
    }
    r.pos = start + size + (size & 1);
  }
  if (!data) throw new Error("WAV has no data");
  const out = Array.from({ length: channels }, () => [] as number[]);

  if (format === 1) {
    const step = bits / 8;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i + step * channels <= data.length; i += step * channels) {
      for (let c = 0; c < channels; c++) {
        const o = i + c * step;
        out[c].push(bits === 8 ? (data[o] - 128) / 128 : view.getInt16(o, true) / 32768);
      }
    }
  } else if (format === 0x11) {
    samplesPerBlock ||= ((blockAlign - 4 * channels) * 8) / (4 * channels) + 1;
    // The last block may be short: decoded as far as it goes (it holds the sound's end).
    for (let b = 0; b + 4 * channels <= data.length; b += blockAlign) {
      const len = Math.min(blockAlign, data.length - b);
      const view = new DataView(data.buffer, data.byteOffset + b, len);
      const pred: number[] = [];
      const idx: number[] = [];
      for (let c = 0; c < channels; c++) {
        pred[c] = view.getInt16(c * 4, true);
        idx[c] = Math.min(88, view.getUint8(c * 4 + 2));
        out[c].push(pred[c] / 32768);
      }
      // After the headers: 4-byte chunks per channel, each holding 8 samples.
      let p = 4 * channels;
      const nibble = (c: number, n: number) => {
        const step = STEPS[idx[c]];
        let diff = step >> 3;
        if (n & 1) diff += step >> 2;
        if (n & 2) diff += step >> 1;
        if (n & 4) diff += step;
        pred[c] = Math.max(-32768, Math.min(32767, pred[c] + (n & 8 ? -diff : diff)));
        idx[c] = Math.max(0, Math.min(88, idx[c] + INDEX[n]));
        out[c].push(pred[c] / 32768);
      };
      while (p + 4 * channels <= len && out[0].length % samplesPerBlock !== 0) {
        for (let c = 0; c < channels; c++) {
          for (let k = 0; k < 4; k++) {
            const byte = view.getUint8(p + c * 4 + k);
            nibble(c, byte & 15);
            nibble(c, byte >> 4);
          }
        }
        p += 4 * channels;
      }
    }
  } else {
    throw new Error(`unsupported WAV format ${format}`);
  }
  return { sampleRate, channels, data: out.map((s) => Float32Array.from(s)) };
}
