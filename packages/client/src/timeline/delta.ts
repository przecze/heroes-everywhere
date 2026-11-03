// A game's timeline keeps its points small: a point is the change from the point before it (only the
// parts of the state that changed), with a whole state every few points so going back never needs a
// long chain. Works on plain JSON (the state after a JSON round trip): objects, arrays, numbers,
// strings, booleans and null.

type Path = (string | number)[];
/**
 * One change: [path, value] sets it, [path] deletes an object's key, [path, length, 0] cuts an array
 * short (the log and the objects grow at their end, so the common front is compared item by item).
 */
export type Op = [Path, unknown?, 0?];
export type Patch = Op[];

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What turns `a` into `b`. */
export function diff(a: unknown, b: unknown): Patch {
  const out: Patch = [];
  walk(a, b, [], out);
  return out;
}

function walk(a: unknown, b: unknown, path: Path, out: Patch) {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) walk(a[i], b[i], [...path, i], out);
    for (let i = n; i < b.length; i++) out.push([[...path, i], b[i]]);
    if (b.length < a.length) out.push([path, b.length, 0]);
    return;
  }
  if (plain(a) && plain(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) out.push([[...path, k]]);
    for (const k of Object.keys(b)) walk(a[k], b[k], [...path, k], out);
    return;
  }
  out.push([path, b]);
}

/** `base` with the changes made (a fresh copy: `base` stays as it was). */
export function patch<T>(base: T, ops: Patch): T {
  let root: unknown = structuredClone(base);
  for (const [path, value, cut] of ops) {
    if (!path.length) {
      root = value;
      continue;
    }
    let at = root as Record<string | number, unknown>;
    for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>;
    const last = path[path.length - 1];
    if (cut === 0) (at[last] as unknown[]).length = value as number;
    else if (value === undefined) delete at[last];
    else at[last] = value;
  }
  return root as T;
}

/** Text squeezed (gzip) and back: the browsers' and Node's own CompressionStream. */
export async function pack(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unpack(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
