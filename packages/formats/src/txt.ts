import { decodeText } from "./reader.ts";

/**
 * Tab-separated text table (CRTRAITS.TXT and friends). Cells may be
 * double-quoted and then contain newlines. Rows keep empty cells.
 */
export function parseTxt(bytes: Uint8Array): string[][] {
  const text = decodeText(bytes);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Plain line list (GENRLTXT.TXT style). */
export function parseLines(bytes: Uint8Array): string[] {
  return decodeText(bytes).split(/\r?\n/);
}

/**
 * The original's text tables (HELP.TXT, GENRLTXT...): rows of tab-separated fields; a field in quotes
 * may span lines and doubles its own quotes (VCMI's CLegacyConfigParser).
 */
export function legacyRows(bytes: Uint8Array): string[][] {
  const src = decodeText(bytes);
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < src.length) {
    let field = "";
    // An unquoted entry may itself start with a doubled quote (ADVEVENT's Border Guard:
    // `""No one told me of your coming,"" says...`): two quotes and then text, not an empty field.
    const doubled = src[i] === '"' && src[i + 1] === '"' && src[i + 2] !== undefined && !'"\t\r\n'.includes(src[i + 2]);
    if (src[i] === '"' && !doubled) {
      i++;
      for (;;) {
        const q = src.indexOf('"', i);
        if (q < 0) {
          field += src.slice(i);
          i = src.length;
          break;
        }
        field += src.slice(i, q);
        i = q + 1;
        if (src[i] === '"') {
          field += '"';
          i++;
        } else break;
      }
      field = field.replace(/\r\n/g, "\n");
      // Anything after the closing quote up to the separator is dropped.
      while (i < src.length && src[i] !== "\t" && src[i] !== "\r" && src[i] !== "\n") i++;
    } else {
      const start = i;
      while (i < src.length && src[i] !== "\t" && src[i] !== "\r" && src[i] !== "\n") i++;
      // Quotes inside an unquoted entry are doubled too.
      field = src.slice(start, i).replace(/""/g, '"');
    }
    row.push(field);
    if (src[i] === "\t") i++;
    else {
      if (src[i] === "\r") i++;
      if (src[i] === "\n") i++;
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}
