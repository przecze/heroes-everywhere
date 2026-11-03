// Our hand fixes to a generated table (patches/<table>.patch): made here from the generated text and the committed
// table, applied here to the generated text. No outside tool is needed for either.
//
// A patch holds only our side: upstream's words never appear in it (the open-source release carries the patches,
// not upstream's files). Each changed line of the generated table is named by its number and a hash of what upstream
// made there, then only the pieces we changed, as tokens (a string, a number, a word, a mark):
//
//   ~39 3f2a9c1e                         line 39 of the generated table, whose text hashes to 3f2a9c1e
//     @14+1 "mods/x/tbcsback.png"         its tokens from the 14th, 1 of them, become these
//   -52 77ab01de                         line 52 goes
//   +52 {"key":"ours"},                  a line of ours after line 52 (0: before the first)
//
// The generated text is the same on every build (upstream is pinned), so a hash that no longer matches means
// upstream or a generator changed under the fix: that fails loudly, naming the line.
import { createHash } from "node:crypto";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);
const TOKEN = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\s+|[A-Za-z_$][\w$]*|[^]/g;
const tokens = (line: string) => line.match(TOKEN) ?? [];

/** The longest common subsequence's edit script of two sequences: [' ' | '-' | '+', item]. */
function diff<T>(x: T[], y: T[]): [" " | "-" | "+", T][] {
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail), ys = y.slice(head, y.length - tail);
  const n = xs.length, m = ys.length;
  const L = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i * (m + 1) + j] = xs[i] === ys[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  const ops: [" " | "-" | "+", T][] = x.slice(0, head).map((l) => [" ", l]);
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) ops.push([" ", xs[i++]]), j++;
    else if (j < m && (i === n || L[i * (m + 1) + j + 1] >= L[(i + 1) * (m + 1) + j])) ops.push(["+", ys[j++]]);
    else ops.push(["-", xs[i++]]);
  }
  for (const l of x.slice(x.length - tail)) ops.push([" ", l]);
  return ops;
}

/** One line's change as token edits: `@<first token>+<how many> <our tokens>`. */
function lineEdits(a: string, b: string): string[] {
  const ops = diff(tokens(a), tokens(b));
  const out: string[] = [];
  let at = 0;
  for (let k = 0; k < ops.length; ) {
    if (ops[k][0] === " ") (at++, k++);
    else {
      let gone = 0, ours = "";
      while (k < ops.length && ops[k][0] !== " ") {
        if (ops[k][0] === "-") gone++;
        else ours += ops[k][1];
        k++;
      }
      out.push(`  @${at}+${gone} ${ours}`);
      at += gone;
    }
  }
  return out;
}

/** The patch turning `a` (generated) into `b` (committed), "" when they are equal. */
export function makePatch(a: string, b: string, name: string): string {
  if (a === b) return "";
  const x = a.split("\n"), y = b.split("\n");
  const ops = diff(x, y);
  const out = [`--- ${name} (generated)`, `+++ ${name} (with our fixes)`];
  let line = 0; // lines of `a` passed
  for (let k = 0; k < ops.length; ) {
    if (ops[k][0] === " ") (line++, k++);
    else {
      const gone: string[] = [], added: string[] = [];
      while (k < ops.length && ops[k][0] !== " ") (ops[k][0] === "-" ? gone : added).push(ops[k++][1]);
      // Lines that go and lines that come pair up as changed lines; the rest go, or come after them.
      const pairs = Math.min(gone.length, added.length);
      for (let p = 0; p < gone.length; p++) {
        const n = line + p + 1;
        if (p < pairs) out.push(`~${n} ${hash(gone[p])}`, ...lineEdits(gone[p], added[p]));
        else out.push(`-${n} ${hash(gone[p])}`);
      }
      for (const l of added.slice(pairs)) out.push(`+${line + gone.length} ${l}`);
      line += gone.length;
    }
  }
  return `${out.join("\n")}\n`;
}

/** `text` with the patch applied; a line whose hash doesn't match is an error naming it. */
export function applyPatch(text: string, patch: string, name: string): string {
  if (!patch.trim()) return text;
  const lines = text.split("\n");
  const now: (string | null)[] = [...lines];
  const after = new Map<number, string[]>();
  const check = (n: number, h: string) => {
    if (lines[n - 1] === undefined || hash(lines[n - 1]) !== h)
      throw new Error(`${name}: our fix to line ${n} no longer fits the generated table (it was ${h}); regenerate the patch (build.ts --keep) after checking it`);
  };
  const rows = patch.replace(/\n$/, "").split("\n").slice(2);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const m = /^([~+-])(\d+) (.*)$/.exec(row);
    if (!m) throw new Error(`${name}: patch line "${row.slice(0, 40)}" isn't ~N, -N or +N`);
    const n = Number(m[2]);
    if (m[1] === "+") (after.get(n) ?? after.set(n, []).get(n)!).push(m[3]);
    else if (m[1] === "-") (check(n, m[3]), (now[n - 1] = null));
    else {
      check(n, m[3]);
      const t = tokens(lines[n - 1]);
      const edits: [number, number, string][] = [];
      while (rows[r + 1]?.startsWith("  @")) {
        const e = /^  @(\d+)\+(\d+) (.*)$/.exec(rows[++r]);
        if (!e) throw new Error(`${name}: patch line "${rows[r].slice(0, 40)}" isn't an edit (  @T+N ours)`);
        edits.push([Number(e[1]), Number(e[2]), e[3]]);
      }
      for (const [at, gone, ours] of edits.reverse()) t.splice(at, gone, ours);
      now[n - 1] = t.join("");
    }
  }
  const out: string[] = [...(after.get(0) ?? [])];
  now.forEach((l, i) => {
    if (l !== null) out.push(l);
    out.push(...(after.get(i + 1) ?? []));
  });
  return out.join("\n");
}
