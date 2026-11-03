# Heroes Everywhere

Heroes of Might and Magic III, rewritten from scratch for the browser. It plays on a computer and on a phone held either
way. Fully implemented rules, early playable AI.

<p align="center"><img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/everywhere.webp?v=e5fb40b8" width="720" alt="A browser opens the game on a computer; the same game becomes a phone held upright, then sideways"></p>

▶️ <a href="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/gameplay-phone.mp4?v=670ace37">Gameplay demo (phone upright, 3 minutes, with sound)</a>: picking a scenario, recruiting a
hero, building a building, upgrading a stack, levelling up, splitting stacks, a battle with tactics and spells, capturing a
map object, ending a turn.

## Polish: about 90%

The game is fully playable end to end; the AI is still relatively weak. Every hour of playtesting still turns up small
interface glitches and mechanics to bring closer to the original.

| | Status |
| --- | --- |
| 📱 Single player on a phone held upright, against the AI | ✅ Played by human playtesters (most of the testing); the early AI is still weak |
| ✈️ Offline on a phone | ✅ Played by human playtesters |
| ☁️ One game across devices | ✅ Played by human playtesters |
| 💻 Desktop, 📱 a phone sideways | 🟡 Included, lightly played |
| 🎲 Random map generator | 🟡 Included, not tested by human playtesters |
| 👥 Hot seat | 🟡 Included, not tested by human playtesters |
| 🌐 Network multiplayer | 🟡 Included, not tested by human playtesters |
| 📖 Campaigns | 🟡 Included, not tested by human playtesters |
| 🌍 English | ✅ Played by human playtesters |
| 🇵🇱 Polish, 🇩🇪 German | ✅ Played by human playtesters; the interface machine-translated and corrected by them, the original's texts from VCMI's community packs ([Languages](#languages)) |
| 🇷🇺 Russian | 🟡 Included, not tested by human playtesters; the original's texts from the Horn of the Abyss installer, which carries the whole Russian release |
| 🇺🇦 Ukrainian, 🇫🇷 French, 🇪🇸 Spanish | 🟡 Included, not tested by human playtesters; the interface machine-translated; French and Spanish texts from VCMI's packs, Ukrainian ones stay English |

## Made for phones

The original's screens, laid out again for a phone: panels you can move and reshape, towns in one column, and a
touchpad that aims in battle.

<p align="center">
<img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/phone-map.webp?v=53b5d61e" width="250" alt="The adventure map on a phone: the hero walks to an Obelisk, and its piece of the puzzle map shows">
<img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/phone-town.webp?v=a00e98b1" width="250" alt="A Fortress on a phone: City Hall, the Captain's Quarters built">
<img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/phone-battle.webp?v=f7bec1be" width="250" alt="A siege of a Necropolis castle on a phone: a finger slides on the touchpad, a Phoenix and the Archangels fly over the walls">
</p>

## One game on every device

Games are kept on your server as you play. Close the browser on your computer, open the game on your phone, and
you are where you left off.

<p align="center"><img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/cloud-saves.webp?v=5d45f0bf" width="720" alt="A hero walks through a swamp in a browser on a computer; the browser closes; a phone slides in on the same hero and walks her on"></p>

## The whole rulebook

Not a demo with a few units: the full game of Shadow of Death and Horn of the Abyss.

| | Implemented | 🧪 Proven in its own scene | 🤖 The AI uses it |
| --- | :---: | :---: | :---: |
| 🐉 Creatures | ✅ 195 | ✅ 189 battles (not yet the 6 war machines) | ✅ 189 (not the war machines) |
| 🧙 Heroes, each with their specialty | ✅ 231 | ✅ 231 | ⏳ not counted yet |
| 💍 Artifacts | ✅ 164 | ✅ 164 | ✅ 164 |
| 🗺️ Map object kinds | ✅ 164 | ✅ 142 scenes | 🟡 134 of the 142 |
| ✨ Spells | ✅ 70 | ✅ 70 | ✅ 70 |
| 📜 Secondary skills | ✅ 30 | ✅ 30 | ⏳ not counted yet |
| 🏰 Town buildings | ✅ 458 | ✅ 458 | 🟡 452 |

A scene is a map or a battle just big enough to show one thing working (1,290 in all): each creature fights on both
sides, so it is used, attacked and attacks you. Each is played headless and checked on every change:
`docker compose exec game node packages/sim/src/scenecheck.ts` (maps) and `… battlecheck.ts` (battles). Open one in the game:
http://localhost:8080/#map?map=scene:spell-0 (or `scene:artifact-5`, `scene:building-12`, `scene:object-40`...).
The AI column counts what the computer players did in the AI's own check games (`packages/sim/src/aicheck.ts`).

## AI included

Not as good as the original's yet, but at least it doesn't cheat.

The AI is the youngest part of the game and its weakest. An experienced player will beat it.

- **It doesn't cheat.** The original game's computer sees the whole map, every army's exact size and every garrison. This AI sees only what a human in its seat would see: explored ground, monsters and garrisons by their band ("a pack", "lots"), rival heroes only while in sight, and none of a rival's resources.
- **It plays a battle out before choosing it.** Each fight is played on a copy of the game by the same battle AI. A stack it knows only by its band is tried at several counts within that band.
- **It builds by return.** It picks each building by how fast it pays back toward the Capitol and the top dwellings, saving up and trading at the market when that's worth it.
- **It values what a passage opens.** A guard, a garrison, a key or border gate, a boat, or a monolith into unexplored land is worth what lies behind it.
- **One main hero** carries the army and takes the experience. The other heroes gather resources and bring it troops.
- **It casts adventure spells:** View Air/Earth, Dimension Door, Fly, Water Walk, Town Portal, Summon/Scuttle Boat, Disguise, Visions.
- **It never surrenders,** as in the original. It can retreat.

### How it handles the map (simulated, Hard)

| Situation | How it does |
|---|---|
| Building up alone | Good: Capitol around day 13, upgraded 7th-level dwelling by day 32 |
| Several towns | Good, though a second town sometimes leaves gold unspent |
| Fighting a rival | Takes the rival's town around day 28 on small maps, day 60 on medium |
| Garrisons, monoliths, underground | Fair: breaks out of its start area 10-15 days later than a good player |
| Keys and border gates | Weak: reaches the key in about a third of games |
| Sea | Fair: sails on about two thirds of sea maps by day 28 |
| Against a person | Behind: Capitol on day 11-13 against a good player's day 8; main hero level 7-10 against 15 by day 37 |

The AI in every seat on the original's own maps, nobody watching: eight players on Free for All and on Realm of Chaos, both
still open after 200 days, and two on Key to Victory, won on day 90.

<p align="center"><img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/ai-free-for-all.svg?v=65989ce4" width="900" alt="Towns held by each of eight computer players on Free for All over 200 days: towns change hands all game, four players are out by day 185, Tan holds eight towns at its peak"></p>

<p align="center"><img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/ai-realm-of-chaos.svg?v=b690f785" width="900" alt="Towns held by each of eight computer players on Realm of Chaos over 200 days: Red climbs to four towns, four players are out by day 129, three still hold on"></p>

<p align="center"><img src="https://pub-d5c06a60f8ee4c5ba63e01a1b2a4656c.r2.dev/ai-key-to-victory.svg?v=66097e8e" width="900" alt="Two computer players on Key to Victory: both build a Capitol in the first month, Red takes Blue's town and wins on day 90"></p>

`docker compose exec -e RACE_ENGINES=fresh game node packages/sim/src/race.ts --map "Free for All.h3m" --days 200 --seed 1 > race.json`
plays such a game headless: each side's towns day by day and the milestones it reached.

## Horn of the Abyss

- **Its rule tweaks and quality of life: re-implemented here**, in every game.
- **Its content and art** (the Cove, Factory and Bulwark towns, their creatures and heroes, the new objects, its maps):
  only when you provide the files (see below).

## Is it safe to run?

You may not want to run a repository from the internet just because it looks exciting. Here is what this one does to
your machine; each point can be checked in the files it links.

1. **Everything runs in one unprivileged container.** The game's server runs in Docker ([compose.yml](compose.yml),
   [Dockerfile](Dockerfile)) as the image's user `node`, not root, with no Linux capabilities, `no-new-privileges` and
   a read-only file system. It writes only to its own two Docker volumes (the unpacked game files and your saved games)
   and a scratch `/tmp`, reads your `installers/` folder read-only, and sees nothing else of your machine. It listens
   on `127.0.0.1:8080` only, unless you set `BIND`.
2. **The build fetches pinned, checked files, and uses none of your accounts.** `docker compose up --build` downloads
   the Node base image by its sha256 digest; the npm packages at the exact versions in
   [package-lock.json](package-lock.json), each checked against its sha512; VCMI's and the HotA mod's data files from
   GitHub at fixed commits, each checked against its sha256 in
   [packages/vcmi-data/sources.json](packages/vcmi-data/sources.json) (a mismatch stops the build); and three Debian
   packages (innoextract to unpack the installers, ffmpeg for the game's videos, git for language packs) from Debian's
   signed archive. No login, token or key of yours is asked for or used, and nothing is uploaded.
3. **Running, it calls out only when you ask.** The server makes no outside requests: no telemetry, no accounts. The
   one exception is a language pack, fetched from its GitHub repository at a fixed commit when you pick it on the
   setup page.
4. **Few npm packages, pinned, none fresher than a week.** No package's install script ever runs
   ([.npmrc](.npmrc)'s `ignore-scripts`, and `npm ci --ignore-scripts` in the Dockerfile). Every version in the
   lockfile had been on npm for at least 7 days when it was taken (supply-chain attacks are usually caught and pulled
   within days), and `min-release-age=7` in [.npmrc](.npmrc) keeps it so. The running server loads one of them, `ws`;
   the rest only build the page (TypeScript, Vite, PixiJS).

## What you need

It contains no game files: they come from your own copy of the game.

| | What | How to get it | What it brings |
| --- | --- | --- | --- |
| **Required** | Heroes of Might and Magic III Complete | GOG's offline installer: `setup_heroes_of_might_and_magic_3_complete_….exe` and the `.bin` file beside it, into `installers/` | The whole game: its art, sounds, music, texts, maps and campaigns |
| Optional | Horn of the Abyss installer | `HotA_…_setup.exe` from the Horn of the Abyss site, into `installers/` | Its maps, texts and random map templates |
| Optional | Horn of the Abyss content | VCMI's mod, [github.com/vcmi-mods/horn-of-the-abyss](https://github.com/vcmi-mods/horn-of-the-abyss) (CC BY-SA 4.0) at [9b64ba6](https://github.com/vcmi-mods/horn-of-the-abyss/tree/9b64ba62f39b50399f1390bd502c2593dc850fad), the commit this game was checked with ([zip](https://github.com/vcmi-mods/horn-of-the-abyss/archive/9b64ba62f39b50399f1390bd502c2593dc850fad.zip), about 500 MB unpacked), unpacked so that its `mod.json` sits in `installers/hota-mod/` | The Cove, Factory and Bulwark towns, their creatures and heroes, the new objects |
| Automatic | VCMI's and the HotA mod's data files (creature, spell, object and town tables) | Nothing to do: the image downloads them from GitHub at pinned commits, checked by sha256, when it is built | The rules' numbers the original keeps inside its program |
| Optional | A language pack | Picked on the setup page (http://localhost:8080/setup), fetched from VCMI's community translations; see [Languages](#languages) | The original's texts in a language your installer doesn't have (Polish, German, French, Spanish) |

## Start it

1. Put the installers in the `installers/` folder.
2. `docker compose up --build`
3. Open <http://localhost:8080>.

The first start unpacks the installers into a Docker volume (a few minutes); later starts are immediate.

Then open <http://localhost:8080/setup>: it shows what was found in your installers and which languages the game
speaks with them.

Or ask your coding agent: "Set this up with my installers and start it." Everything it needs is in this file,
`compose.yml` and `setup/`.

## Languages

The game's own menus and windows come in English, Polish, German, Russian, Ukrainian, French and Spanish. The original
game's texts come from your installer, in its language; the HotA installer adds Russian. For another language, the
setup page offers community translations made for VCMI, fetched from their own repositories onto your server only
(none is part of this repository; their licences are their authors'):

| Language | Translation |
|---|---|
| Polski | https://github.com/vcmi-mods/polish-translation |
| Deutsch | https://github.com/vcmi-mods/german-translation |
| Français | https://github.com/vcmi-mods/french-translation |
| Español | https://github.com/vcmi-mods/spanish-translation |

Without the page: `docker compose exec game node setup/pack.ts pl`. Then pick the language in Options → Language.

## Play on the go

No server needed: your own computer is enough, once.

1. Start it on your computer as above.
2. Open it on the phone over HTTPS. Browsers keep a page's files on the device only for HTTPS pages, so
   `http://192.168.…:8080` won't do. One free way is [Tailscale](https://tailscale.com) on both devices and
   `tailscale serve 8080` on the computer: the phone opens the `https://….ts.net` address it prints. Set `PUBLIC_HOST` to
   that name.
3. On the phone: ☰ → Play offline. The whole game is kept on the phone, and a single-player game goes on with no
   connection at all, on a train, abroad, with the computer switched off.

To play from anywhere with a connection too (cloud saves, multiplayer), run the same container on a server of yours,
behind a login such as Tailscale or a reverse proxy with a password: whoever can open the page can play on it and fetch
the game files from it.

## Made with Claude Code

Written from scratch in under two weeks by a group of Claude Opus 5.5 agents in Claude Code, guided by about 40 hours
of human play and feedback so far, mostly the author's, plus a handful of friends. Estimated use: roughly 200 million tokens.

## As it is

This is a release of the source, as it is. There are no issues, pull requests or support: fork it if you want to
change it. It works for us with the installers above; other versions of the game may need changes.

## Credits

Heroes of Might and Magic is a trademark of Ubisoft. Horn of the Abyss is the work of the HotA Crew. This project is
not associated with or supported by Ubisoft or the HotA Crew; it reads your own copy of the game and contains none of
its art, sounds or texts. Many rules and layouts were checked against VCMI (https://vcmi.eu), the open-source engine
for Heroes III, and the Heroes III wiki (https://heroes.thelazy.net).

## Licence

MIT (see LICENSE). That covers this repository only. What the build fetches keeps its own licence and is not part of
it: VCMI's config files (GPL-2.0-or-later) and VCMI's Horn of the Abyss mod (CC BY-SA 4.0), from which the image makes
its data tables (packages/vcmi-data), and the language packs the setup page fetches. Your game files stay yours.
