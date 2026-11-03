// VCMI's config files are JSON with comments (// and /* */), trailing commas and, here and there, a key written twice
// (gameConfig's looped campaign videos). parseVjson reads them as JSON.parse would (the last of a twice-written key
// wins); vjsonEntries keeps every entry of every object, in file order.

/** An object read with every entry kept, in file order. */
export class Entries {
  readonly list: [string, unknown][];
  constructor(list: [string, unknown][]) {
    this.list = list;
  }
  get(k: string): unknown {
    return this.list.find(([n]) => n === k)?.[1];
  }
}

function parse(text: string, keep: boolean): unknown {
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === "/" && text[i + 1] === "/") while (i < text.length && text[i] !== "\n") i++;
      else if (text[i] === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 2;
      else return;
    }
  };
  const fail = (what: string): never => {
    throw new Error(`${what} at ${text.slice(0, i).split("\n").length}:${i - text.lastIndexOf("\n", i - 1)}`);
  };
  const value = (): unknown => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const list: [string, unknown][] = [];
      for (;;) {
        ws();
        if (text[i] === "}") return (i++, keep ? new Entries(list) : Object.fromEntries(list));
        const k = value();
        if (typeof k !== "string") fail("a key");
        ws();
        if (text[i++] !== ":") fail("':'");
        list.push([k as string, value()]);
        ws();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") fail("',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const out: unknown[] = [];
      for (;;) {
        ws();
        if (text[i] === "]") return (i++, out);
        out.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("',' or ']'");
      }
    }
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      i++;
      return JSON.parse(text.slice(start, i).replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, ""));
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40));
    if (!m) fail("a value");
    i += m![0].length;
    return JSON.parse(m![0]);
  };
  const v = value();
  ws();
  if (i < text.length) fail("the end");
  return v;
}

export const parseVjson = (text: string): unknown => parse(text, false);
export const vjsonEntries = (text: string): unknown => parse(text, true);
