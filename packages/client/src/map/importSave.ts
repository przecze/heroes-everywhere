// Load Game's "Import a saved game of the original": a HoMM3 / HotA .GM1 picked from the device is
// read (formats' h3save.ts), started again from the same scenario here and filled with what the save
// holds (core importSave.ts), kept among the saved games and opened. EXTRAS importSaves.
import { type AdventureState, importOriginalSave, saveMapDiffers } from "@heroes/core";
import { type H3Map, parseH3Save } from "@heroes/formats";
import { loadData } from "../gameData.ts";
import { tr, type Text, said } from "../i18n/index.ts";
import { saveGame } from "../saves.ts";
import { markImported } from "../timeline/store.ts";
import { type Modals } from "../ui/modals.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { type MapInfo } from "../ui/newGameModel.ts";

/** The Load list's entry for it. */
export const IMPORT_ENTRY = "import:original";

export interface ImportHost {
  modals: Modals;
  color: () => number;
  mapsInfo: () => Promise<MapInfo[]>;
  loadMap: (file: string) => Promise<H3Map>;
  open: (file: string, saved: AdventureState) => Promise<boolean | void>;
}

/** The device's file picker for one save; undefined when nothing was picked. */
function pickFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // (Phones don't know the .GM1 type: any file, the reader says if it isn't a save.)
    if (!/Android|iPhone|iPad/.test(navigator.userAgent)) input.accept = ".gm1,.gm2,.gm3,.gm4,.gm5,.gm6,.gm7,.gm8,.cgm";
    input.style.display = "none";
    input.addEventListener("change", () => resolve(input.files?.[0]));
    input.addEventListener("cancel", () => resolve(undefined));
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  });
}

/** Picks, reads and opens an original save; true when a game was opened. */
export async function importOriginalSaveFile(host: ImportHost): Promise<boolean> {
  const say = (text: Text) => dialog(host.modals, text, host.color());
  const file = await pickFile();
  if (!file) return false;
  let save;
  try {
    save = parseH3Save(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    await say(tr("%1 couldn't be read as a saved game of the original: %2", file.name, err instanceof Error ? err.message : String(err)));
    return false;
  }
  if (save.campaign) {
    await say(tr("%1 is a campaign's save: only single scenarios can be carried on here so far.", file.name));
    return false;
  }
  // The scenario it was played on: by its file name, else by its name and size.
  const maps = await host.mapsInfo();
  const lower = save.mapFile.toLowerCase();
  const candidates = [...maps.filter((m) => m.file.toLowerCase() === lower), ...maps.filter((m) => m.file.toLowerCase() !== lower && m.name === save.name && m.size === save.size && m.levels === save.levels)];
  let map: H3Map | undefined;
  let info: MapInfo | undefined;
  for (const m of candidates) {
    const loaded = await host.loadMap(m.file).catch(() => undefined);
    if (loaded && !saveMapDiffers(save, loaded)) [map, info] = [loaded, m];
    if (map) break;
  }
  if (!map || !info) {
    await say(tr("This save's map, %1, isn't among the scenarios here, so it can't go on yet.", save.mapFile || save.name));
    return false;
  }
  const data = await loadData();
  const { state, report } = importOriginalSave(map, data, save, { seed: (Math.random() * 2 ** 31) | 0, mapFile: info.file });
  const name = `${save.name || info.name} (${file.name})`;
  await saveGame(name, state).catch(() => {});
  const notRead: Record<string, string> = { date: tr("the date"), resources: tr("resources"), buildings: tr("town buildings"), "flagged mines and dwellings": tr("flagged mines and dwellings"), "visited objects": tr("places visited"), quests: tr("quests") };
  await say(
    said(tr("Carried over from %1: %2 heroes with their skills, spells, armies and artifacts; %3 towns; %4 things taken off the map; %5 monsters' numbers; what each player has explored.", file.name, String(report.heroes), String(report.towns), String(report.objectsGone), String(report.monsters)) +
      "\n\n" +
      tr("Not read from this save, so as the scenario starts: %1.", report.notRead.map((k) => notRead[k] ?? k).join(", "))),
  );
  markImported(state);
  await host.open(state.mapFile, state);
  return true;
}
