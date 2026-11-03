// The setup page (/setup): what this server found in your installers, which languages the game can speak with them,
// and buttons that add a language pack (setup/pack.ts) from a community translation. The packs' files are served
// at /l10n/<lang>/, where the page reads them.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { LANGUAGES } from "./src/i18n/languages.ts";
import { PACKS, SOURCES } from "./packs.ts";

const app = resolve(import.meta.dirname, "../..");
const l10n = () => process.env.L10N_DIR ?? resolve(app, ".state/l10n");
const read = (f: string) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return undefined;
  }
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** What setup/install.sh found and unpacked. */
function found() {
  const inst = (read(resolve(process.env.GAME_DIR ?? "/game", "installers.json")) ?? {}) as { gog?: string; hota?: string };
  const lang = /\((polish|german|french|spanish|russian|czech|chinese|italian|korean|hungarian|portuguese)\)/i.exec(inst.gog ?? "")?.[1]?.toLowerCase() ?? "english";
  const modDir = (process.env.HEROES_LOOSE_DIRS ?? "").split(":")[0];
  const mod = !!modDir && existsSync(modDir) && readdirSync(modDir).length > 0;
  return { gog: inst.gog, gogLanguage: lang, hota: inst.hota, mod, russian: read(resolve(l10n(), "ru/lang.json")) as { from?: string } | undefined };
}

/** Each pack's state: not added, being made, ready (with where it came from), or failed. */
function packs() {
  return Object.entries(PACKS).map(([code, p]) => {
    const status = read(resolve(l10n(), code, "status.json")) as { state: string; detail?: string } | undefined;
    const about = read(resolve(l10n(), code, "about.json")) as { added?: string; maps?: boolean } | undefined;
    return { code, name: p.name, repo: p.repo, sha: p.sha, licence: p.licence, state: about && status?.state !== "working" ? "ready" : (status?.state ?? "none"), detail: status?.detail, maps: about?.maps };
  });
}

export function status() {
  return { found: found(), packs: packs(), interface: Object.values(LANGUAGES).map((l) => l.name), sources: SOURCES };
}

function page(): string {
  const s = status();
  const f = s.found;
  const tick = (ok: boolean, text: string) => `<li class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${text}</li>`;
  const gogLang = f.gogLanguage[0].toUpperCase() + f.gogLanguage.slice(1);
  const rows = s.packs
    .map((p) => {
      const action =
        p.state === "ready"
          ? `<span class="ok">✓ added</span>${p.maps ? "" : " (without the maps' own texts: no maps found)"} <button data-pack="${p.code}">Fetch again</button>`
          : p.state === "working"
            ? `<span>being made: ${esc(p.detail ?? "")}…</span>`
            : `${p.state === "failed" ? `<span class="no">failed: ${esc(p.detail ?? "")}</span> ` : ""}<button data-pack="${p.code}">Add ${esc(p.name)}</button>`;
      return `<tr><td><b>${esc(p.name)}</b></td><td><a href="https://github.com/${p.repo}/tree/${p.sha}">github.com/${p.repo}</a><br><small>at ${p.sha.slice(0, 7)}; licence: ${esc(p.licence)}</small></td><td>${action}</td></tr>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Heroes Everywhere: setup</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#1a140c;color:#f0e0b0;font:16px/1.45 Georgia,serif;padding:16px}main{max-width:820px;margin:auto}
h1{color:#ffd860;margin:.2em 0}h2{color:#ffd860;font-size:1.15em;margin-top:1.6em;border-bottom:1px solid #6b5527}a{color:#ffd860}
ul{padding-left:0;list-style:none}li{margin:.25em 0}.ok{color:#9be37a}.no{color:#e88a6a}small{color:#c8b88a}
table{border-collapse:collapse;width:100%}td{border-top:1px solid #4a3a1c;padding:.5em .4em;vertical-align:top}
button{background:#5a4318;color:#ffe9a8;border:1px solid #b8913c;border-radius:3px;padding:.35em .8em;font:inherit;cursor:pointer}
button:disabled{opacity:.5}.play{display:inline-block;margin-top:1em;font-size:1.1em}
</style><main>
<h1>Heroes Everywhere: setup</h1>
<p>What this server found in your installers, and the languages the game speaks with them. <a class="play" href="/">▶ Play</a></p>
<h2>Your installers</h2><ul>
${tick(!!f.gog, f.gog ? `Heroes of Might and Magic III Complete (GOG): <code>${esc(f.gog)}</code>. Its texts are in <b>${gogLang}</b>: the game's own words (every window, message, hero, spell, map) come from it.` : "No GOG installer: put it in <code>installers/</code> and restart.")}
${tick(!!f.hota, f.hota ? `Horn of the Abyss: <code>${esc(f.hota)}</code>. Its maps, music and HotA's words in English${f.russian ? ", and its Russian release (the game speaks Russian from it)" : ""}.` : "No Horn of the Abyss installer (optional): its maps and music are left out.")}
${tick(f.mod, f.mod ? "The Horn of the Abyss mod in <code>installers/hota-mod/</code>: HotA's towns, creatures and artifacts." : "No Horn of the Abyss mod in <code>installers/hota-mod/</code> (optional): HotA's own towns, creatures and artifacts can't be drawn.")}
</ul>
<h2>Languages</h2>
<p>The menus and windows this game adds are in ${s.interface.map(esc).join(", ")} (machine-translated, corrected by players). The original game's own texts are in the language of your installer: <b>${gogLang}</b>${f.russian ? " and <b>Русский</b>" : ""}. For another language, add its pack below.</p>
<p>A pack has the original game's texts (windows, messages, help), the names of heroes, creatures, spells, artifacts, buildings, towns and map objects, the scenario list, the maps' own texts (signs, events, quests), HotA's words, and the buttons with words on them. Not in any pack: the campaigns' stories, the original's films and voices.</p>
<p><small>The packs are community translations made for VCMI, on GitHub. They are not part of this game: adding one fetches it from its repository, at the commit shown, onto this server only. Their licences are their authors'; where a repository states none, using it is your call. HotA's words come from the <a href="https://github.com/${s.sources.hotaMod.repo}">Horn of the Abyss mod</a> (${esc(s.sources.hotaMod.licence)}), the map objects' numbers from <a href="https://github.com/${s.sources.vcmi.repo}">VCMI</a> (${esc(s.sources.vcmi.licence)}).</small></p>
<table>${rows}</table>
<p><small>After adding a pack, pick its language in the game: Options → Language.</small></p>
</main><script>
for (const b of document.querySelectorAll("button[data-pack]")) b.onclick = async () => { b.disabled = true; b.textContent = "Fetching…"; await fetch("/setup/pack/" + b.dataset.pack, { method: "POST" }); setTimeout(() => location.reload(), 1500); };
if (document.body.textContent.includes("being made")) setTimeout(() => location.reload(), 3000);
</script>`;
}

const TYPES: Record<string, string> = { ".json": "application/json", ".txt": "text/plain; charset=binary", ".def": "application/octet-stream", ".fnt": "application/octet-stream" };
const send = (res: ServerResponse, type: string, body: string | Buffer, code = 200) => {
  res.statusCode = code;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-cache");
  res.end(body);
};

export function setupPage(): Plugin {
  const running = new Set<string>();
  const install = (m: Connect.Server) => {
    m.use("/setup", (req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/status") return send(res, "application/json", JSON.stringify(status()));
      const add = /^\/pack\/(\w+)$/.exec(path);
      if (add && req.method === "POST") {
        const code = add[1];
        if (!PACKS[code]) return send(res, "text/plain", "no such pack", 404);
        if (!running.has(code)) {
          running.add(code);
          const p = spawn(process.execPath, [resolve(app, "setup/pack.ts"), code], { stdio: "inherit", env: process.env });
          p.on("exit", () => running.delete(code));
        }
        return send(res, "application/json", "{}", 202);
      }
      send(res, "text/html; charset=utf-8", page());
    });
    // The packs' files (and the Russian release's, made from the HotA installer).
    m.use("/l10n/", (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "").toLowerCase();
      const dir = l10n();
      const list = /^(\w+)\/index\.json$/.exec(rel);
      if (list && existsSync(resolve(dir, list[1], "sprites"))) return send(res, "application/json", JSON.stringify(readdirSync(resolve(dir, list[1], "sprites"))));
      const file = resolve(dir, rel);
      if (rel.includes("..") || !file.startsWith(`${dir}/`) || !existsSync(file) || !statSync(file).isFile() || /(^|\/)(status|about)\.json$/.test(rel)) return next();
      send(res, TYPES[extname(file)] ?? "application/octet-stream", readFileSync(file));
    });
  };
  return { name: "setup", configureServer: (s) => install(s.middlewares), configurePreviewServer: (s) => install(s.middlewares) };
}
