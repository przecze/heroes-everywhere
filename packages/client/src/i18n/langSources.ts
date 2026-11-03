// Where each language's words come from on this server, for the ☰ language picker: the setup page's status (the
// installers' languages, the packs added or still to fetch, and from where). The menus and windows this game adds
// speak every language; the original game's own texts (windows, messages, names, maps) need the installer in that
// language, or a pack fetched from its repository.
import { tr } from "./index.ts";

/** One language's state: a line under its name, whether the original game's texts are in it, and how to fetch them. */
export interface LangSource {
  note: string;
  full: boolean;
  /** Fetches the language's pack onto this server (resolves once it's ready). */
  add?: () => Promise<void>;
}

interface Status {
  found: { gogLanguage: string; russian?: unknown };
  packs: { code: string; repo: string; state: string; detail?: string }[];
}

const CODES: Record<string, string> = { english: "en", polish: "pl", german: "de", russian: "ru", french: "fr", spanish: "es" };
const NAMES: Record<string, string> = { english: "English", polish: "Polski", german: "Deutsch", russian: "Русский", french: "Français", spanish: "Español" };

const status = (): Promise<Status | null> =>
  fetch("/setup/status")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

export async function langSources(): Promise<Record<string, LangSource> | null> {
  const s = await status();
  if (!s) return null;
  const own = CODES[s.found.gogLanguage] ?? "en";
  const ownName = NAMES[s.found.gogLanguage] ?? "English";
  const partial = tr("Menus only; the game's own texts stay in {lang}").replace("{lang}", ownName);
  const out: Record<string, LangSource> = {};
  for (const code of ["en", "pl", "de", "ru", "uk", "fr", "es"]) out[code] = { note: partial, full: false };
  out[own] = { note: tr("Complete: from your installer"), full: true };
  if (s.found.russian) out.ru = { note: tr("Complete: from your HotA installer"), full: true };
  for (const p of s.packs) {
    if (p.code === own) continue;
    const where = `github.com/${p.repo}`;
    if (p.state === "ready") out[p.code] = { note: tr("Complete: its pack, fetched from {where}").replace("{where}", where), full: true };
    else
      out[p.code] = {
        note: p.state === "working" ? tr("Fetching its pack from {where}…").replace("{where}", where) : tr("Menus only. The game's own texts: fetch its pack from {where}").replace("{where}", where),
        full: false,
        add: async () => {
          await fetch(`/setup/pack/${p.code}`, { method: "POST" });
          for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const now = (await status())?.packs.find((q) => q.code === p.code);
            if (now?.state === "ready") return;
            if (now?.state === "failed") throw new Error(now.detail ?? "failed");
          }
        },
      };
  }
  return out;
}
