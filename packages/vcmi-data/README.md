# vcmi-data

The game's tables that come from other people's data files: VCMI's configs (the engine's description of the original
game) and VCMI's Horn of the Abyss mod. They are made here the same way in this repository and in the open-source
release, so both run on the same tables:

- `upstream/`: the files the generators read, exactly as upstream has them (`sources.json` names the two repositories,
  the commits and every file's sha256). Committed here; the release leaves them out and fetches them from GitHub
  (`gen/fetch.ts`, every file checked against its sha256).
- `gen/`: the generators. `gen/tables/<table>.ts` makes `src/<table>.ts` from the upstream files.
- `patches/`: our changes to the made tables, one table entry per line, so a fix is a line. A patch holds only our
  side: each changed line by its number and a hash of what upstream made there, then only the pieces we changed
  (gen/patch.ts says the format), so no upstream words travel with it.
- `src/`: the finished tables the game imports (core and client re-export them, by relative path: the folder is no npm
  workspace, so the lockfile stays as it is). Committed here; the release builds
  them (`gen/build.ts`) before the client is built.

`npm test` checks that the upstream files match `sources.json` and that `src/` is exactly what `gen/` and `patches/`
make (`node packages/vcmi-data/gen/build.ts --check`).

## Working on a table

- Regenerate one table: `node packages/vcmi-data/gen/build.ts <table>` (from `upstream/`).
- A hand fix: edit `src/<table>.ts`, then `node packages/vcmi-data/gen/build.ts --keep <table>` turns the difference
  into `patches/<table>.patch`.
- A newer upstream: `node packages/vcmi-data/gen/build.ts --from vcmi=<VCMI checkout> hota-mod=<mod checkout>` builds
  from the checkouts (a patch that no longer fits fails loudly); `--pin` then copies the files read into `upstream/`
  and writes their hashes; update the commits in `sources.json` by hand.

## Pins

- VCMI `757fb7e3b18a10f7fbf108de8687bd89fd978c93` (development branch, 2026-07-01: where the tables were first made).
  GPL-2.0-or-later.
- VCMI's Horn of the Abyss mod (github.com/vcmi-mods/horn-of-the-abyss) `9b64ba62f39b50399f1390bd502c2593dc850fad`.
  CC BY-SA 4.0.

## What the patches keep, and why

| Table | Our change |
|---|---|
| artifactData | The resource artifacts' and Legion parts' bonuses left out (rules.ts counts them itself); a few limiters and immunities as the game plays them; the Horn of the Abyss as its own ability |
| battlefields | Two obstacles' footprints, one obstacle's layer; our names for HotA's added battlefields and their underground layer |
| campaignMedia | HotA's campaigns' real music names |
| creatureData | Ten creatures' abilities as HotA has them (the HotA wiki) |
| dwellingData | Two dwelling subtypes |
| heroData | The original heroes' starting creatures (how many of each, the player's HOTRAITS.TXT says at start); two starting skill levels; Resistance for two HotA heroes |
| hotaData | A few HotA creatures' abilities, icons and sounds, and one map stack size, as before the mod's later changes |
| mapSounds | HotA's two terrains' off-road hoof beats |
| specialtyData | Four HotA heroes' specialties |
| spellArt | Some spells' pictures and sounds as the game plays them |
| spellLooks | VCMI's spell look fixes after the pinned commit (from its 2026-10-27 configs) |
| townData | Which classic town pictures and backgrounds HotA's data patch redraws (its files replace the original's by name); our words for the Vault of Ashes |
| townUi | The data patch's building icons, the Conflux hall, a hall background |
| modTexts | (none: the keys it takes are in gen/tables/modTextKeys.txt) |
