// Node-only: serves files out of the original LOD/SND archives on disk.
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { inflateSync } from "node:zlib";
import {
  type ArchiveEntry,
  LOD_ENTRY_SIZE,
  LOD_HEADER_SIZE,
  SND_ENTRY_SIZE,
  lodEntryCount,
  parseLodEntries,
  parseSndEntries,
  hotaLodKey,
} from "./archive.ts";

interface Located extends ArchiveEntry {
  fd: number;
  archive: string;
  /** Loose file on disk instead of an archive entry. */
  path?: string;
}

/** The name the random map templates go by (/res/rmgtemplates.txt). */
const RMG_BUNDLE = "rmgtemplates.txt";

const LOOSE_TYPES = new Set(["def", "pcx", "bmp", "png", "wav", "txt", "fnt", "msk", "pal", "json"]);

function read(fd: number, position: number, length: number): Uint8Array {
  const buf = Buffer.alloc(length);
  readSync(fd, buf, 0, length, position);
  return buf;
}

/**
 * Index of every file in the given data directories. Later directories
 * override earlier ones, so pass the base game first and HotA after it.
 */
export class ResourceStore {
  private readonly entries = new Map<string, Located>();
  /** Entries a later archive replaced (HotA over the original), for files only the original's form can be read. */
  private readonly shadowed = new Map<string, Located>();
  private readonly fds: number[] = [];
  private readonly templateDirs: string[];
  private templates?: Uint8Array;

  /**
   * `dirs`: folders with LOD/SND archives. `looseDirs`: folder trees of single
   * files (e.g. converted mod graphics), indexed by file name; they're added
   * first, so the original archives win on name clashes.
   */
  constructor(dirs: string[], looseDirs: string[] = []) {
    // HotA's random map templates sit beside its loose files: _HD3_Data/Templates/<name>/rmg.txt.
    this.templateDirs = [...(process.env.HOTA_TEMPLATE_DIRS ?? "").split(":").filter(Boolean), ...looseDirs.filter((d) => /_hd3_data[\\/]common[\\/]?$/i.test(d)).map((d) => join(d, "..", "Templates"))];
    for (const dir of looseDirs) this.addLoose(dir);
    for (const dir of dirs) {
      let names: string[];
      try {
        names = readdirSync(dir).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        const lower = name.toLowerCase();
        if (lower.endsWith(".lod")) this.addLod(join(dir, name));
        else if (lower.endsWith(".snd")) this.addSnd(join(dir, name));
        else if (lower.endsWith(".vid")) this.addVid(join(dir, name));
      }
    }
  }

  private add(fd: number, archive: string, list: ArchiveEntry[]) {
    for (const e of list) {
      const old = this.entries.get(e.name);
      if (old && !old.path) this.shadowed.set(e.name, old);
      this.entries.set(e.name, { ...e, fd, archive });
    }
  }

  private addLoose(dir: string, root = dir) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        this.addLoose(path, root);
        continue;
      }
      const lower = name.toLowerCase();
      if (!LOOSE_TYPES.has(lower.split(".").pop() ?? "")) continue;
      const entry = { name: lower, offset: 0, size: 0, compressedSize: 0, fd: -1, archive: dir, path };
      if (!this.entries.has(lower)) this.entries.set(lower, entry);
      // Also by path under sprites/ or data/ ("hota/highlands/tiles.json"), for names that clash.
      const lowerPath = path.toLowerCase();
      for (const marker of ["/sprites/", "/data/"]) {
        const at = lowerPath.lastIndexOf(marker);
        const rel = at >= 0 ? lowerPath.slice(at + marker.length) : "";
        if (rel && !this.entries.has(rel)) this.entries.set(rel, { ...entry, name: rel });
      }
      // And by the whole path under the folder ("mods/mainmenu/content/data/gamselbk.png"), for
      // files every translation has a copy of.
      const full = relative(root, path).toLowerCase().split(sep).join("/");
      if (!this.entries.has(full)) this.entries.set(full, { ...entry, name: full });
    }
  }

  private addLod(path: string) {
    const fd = openSync(path, "r");
    this.fds.push(fd);
    const count = lodEntryCount(read(fd, 0, 12));
    // HotA.lod (1.7+): not an archive the game reads, so it is left alone.
    if (hotaLodKey(read(fd, 0, 16), read(fd, LOD_HEADER_SIZE, 16), count) !== undefined) return;
    const total = statSync(path).size;
    const fits = (e: { name: string; offset: number; size: number; compressedSize: number }) => /^[\x20-\x7e]+$/.test(e.name) && e.offset + (e.compressedSize || e.size) <= total;
    this.add(fd, path, parseLodEntries(read(fd, LOD_HEADER_SIZE, count * LOD_ENTRY_SIZE), count).filter(fits));
  }

  private addSnd(path: string) {
    const fd = openSync(path, "r");
    this.fds.push(fd);
    const count = Buffer.from(read(fd, 0, 4)).readUInt32LE(0);
    this.add(fd, path, parseSndEntries(read(fd, 4, count * SND_ENTRY_SIZE), count));
  }

  /** VID video archives: u32 count, then 44-byte entries (40-byte name, offset); sizes run to the next offset. */
  private addVid(path: string) {
    const fd = openSync(path, "r");
    this.fds.push(fd);
    const count = Buffer.from(read(fd, 0, 4)).readUInt32LE(0);
    const table = Buffer.from(read(fd, 4, count * 44));
    const total = statSync(path).size;
    const list = Array.from({ length: count }, (_, i) => {
      const raw = table.subarray(i * 44, i * 44 + 40);
      const end = raw.indexOf(0);
      return { name: raw.subarray(0, end < 0 ? 40 : end).toString("latin1").toLowerCase(), offset: table.readUInt32LE(i * 44 + 40) };
    }).sort((a, b) => a.offset - b.offset);
    this.add(
      fd,
      path,
      list.map((e, i) => ({ name: e.name, offset: e.offset, size: (list[i + 1]?.offset ?? total) - e.offset, compressedSize: 0 })),
    );
  }

  has(name: string): boolean {
    return this.entries.has(name.toLowerCase());
  }

  get(name: string): Uint8Array | undefined {
    if (name.toLowerCase() === RMG_BUNDLE) return this.rmgTemplates();
    const e = this.entries.get(name.toLowerCase());
    if (!e) return undefined;
    const bytes = this.readEntry(e);
    // HotA's 32-bit "D32F" animations: serve the original game's version instead, which we can decode.
    const old = this.shadowed.get(name.toLowerCase());
    if (old && bytes.length > 4 && bytes[0] === 0x44 && bytes[1] === 0x33 && bytes[2] === 0x32 && bytes[3] === 0x46) return this.readEntry(old);
    return bytes;
  }

  /** The original game's own file where a later archive (HotA's) replaced it (its CREDITS.TXT), else the file as served. */
  original(name: string): Uint8Array | undefined {
    const old = this.shadowed.get(name.toLowerCase());
    return old ? this.readEntry(old) : this.get(name);
  }

  /**
   * Every random map template in one file (core parseRmgBundle): HotA's folders, each RMG.TXT after a
   * line "@@@ <folder>"; without them, the original's own RMG.TXT from the archives. Undefined when neither is there.
   */
  private rmgTemplates(): Uint8Array | undefined {
    if (this.templates) return this.templates;
    const parts: Buffer[] = [];
    for (const dir of this.templateDirs) {
      let folders: string[] = [];
      try {
        folders = readdirSync(dir).sort();
      } catch {
        continue;
      }
      for (const folder of folders) {
        let file: string | undefined;
        try {
          file = readdirSync(join(dir, folder)).find((n) => n.toLowerCase() === "rmg.txt");
        } catch {
          continue;
        }
        if (file) parts.push(Buffer.from(`@@@ ${folder}\n`, "latin1"), Buffer.from(readFileSync(join(dir, folder, file))), Buffer.from("\n"));
      }
    }
    if (!parts.length) {
      const own = this.entries.get("rmg.txt");
      if (!own) return undefined;
      parts.push(Buffer.from("@@@ {Original}\n", "latin1"), Buffer.from(this.readEntry(own)));
      // And HotA's from the HotA mod's VCMI files (core rmgBundleWithVcmi does the same in the page).
      for (const [name, e] of [...this.entries].sort(([p], [q]) => (p < q ? -1 : 1)))
        if (/^mods\/templates\/content\/config\/hota[^/]*\.json$/.test(name)) parts.push(Buffer.from(`\n@@@ ${name.split("/").pop()}\n`, "latin1"), Buffer.from(this.readEntry(e)), Buffer.from("\n"));
    }
    this.templates = new Uint8Array(Buffer.concat(parts));
    return this.templates;
  }

  private readEntry(e: Located): Uint8Array {
    if (e.path) return readFileSync(e.path);
    if (!e.compressedSize) return read(e.fd, e.offset, e.size);
    return inflateSync(read(e.fd, e.offset, e.compressedSize));
  }

  /** Every name, with its size and archive; a loose file known by several names (its file name, its path under
   * sprites/ or data/, its whole path) names the first in `same` on the others. */
  list(): { name: string; size: number; archive: string; same?: string }[] {
    const first = new Map<string, string>();
    return [...this.entries.values()].map((e) => {
      const same = e.path ? first.get(e.path) : undefined;
      if (e.path && !same) first.set(e.path, e.name);
      return {
        name: e.name,
        // Loose files carry no size in their entry: the file's own.
        size: e.path ? statSync(e.path).size : e.size,
        archive: e.archive.split("/").pop()!,
        ...(same ? { same } : {}),
      };
    });
  }

  close() {
    for (const fd of this.fds) closeSync(fd);
  }
}
