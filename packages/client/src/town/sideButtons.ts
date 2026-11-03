// Touch screens bigger than a phone (a tablet): the desktop's town (picture and panel) with big buttons in the room
// beside it: the town's main buildings left, the other towns and Leave right, the treasury down the right; with no
// room beside it (a 4:3 tablet) the same choices behind one button over the picture's corner.
import { B, fortLevel, garrisonHero, hallLevel, visitingHero, type AdvObject, type AdventureState, ownTowns } from "@heroes/core";
import { Container, Sprite } from "pixi.js";
import { loadDef } from "../assets.ts";
import { en, tr, said } from "../i18n/index.ts";
import { extra } from "../settings.ts";
import { WHITE } from "../text.ts";
import { choiceBox } from "../ui/dialogs.ts";
import { label, textButton } from "../ui/kit.ts";
import { phoneSized, screenSize } from "../ui/screen.ts";
import { barIcons } from "./barIcons.ts";
import type { TownScreen } from "./screen.ts";
import { buildingClicked, massRecruit } from "./windows.ts";

export class TownSideButtons {
  private readonly town: TownScreen;
  constructor(town: TownScreen) {
    this.town = town;
  }

  /** Touch layout: big buttons for the town's main buildings left of the screen, towns and leave right. */
  async draw(s: AdventureState, o: AdvObject) {
    const town = this.town;
    const room = screenSize.ox;
    const built = (...ids: number[]) => ids.some((b) => o.town!.built.includes(b));
    const hall = B.VILLAGE_HALL + Math.max(0, hallLevel(o.town!.built));
    const towns = ownTowns(s, o.owner);
    const step = (d: number) => {
      const i = towns.findIndex((x) => x.id === o.id);
      const next = towns[(i + d + towns.length) % towns.length];
      if (next && next.id !== o.id && town.world) void town.show(s, town.world, next.id);
    };
    const go = (id: number) => () => void buildingClicked(town.ctx(), id);
    const left: [string, () => void][] = [[en("Build"), go(hall)]];
    if (fortLevel(o.town!.built)) left.push([en("Recruit"), go(B.FORT)], [en("Recruit all"), () => void massRecruit(town.ctx())]);
    if (built(B.MAGE_GUILD_1)) left.push([en("Mage Guild"), go(B.MAGE_GUILD_1)]);
    if (built(B.TAVERN)) left.push([en("Tavern"), go(B.TAVERN)]);
    if (built(B.MARKETPLACE)) left.push([en("Market"), go(B.MARKETPLACE)]);
    // (Phones have it on the Armies page.)
    const [keeper, visitor] = [garrisonHero(s, o), town.world ? visitingHero(s, town.world, o) : null];
    if (!phoneSized() && keeper && visitor && extra("townExchange") && town.onExchange) left.push([en("Exchange"), () => town.onExchange?.(keeper.id, visitor.id, town.modals)]);
    const right: [string, () => void][] = [];
    if (towns.length > 1) right.push([en("Previous town"), () => step(-1)], [en("Next town"), () => step(1)]);
    right.push([en("Leave town"), () => town.close()]);
    // Bigger screens show the town panel, whose hall and fort pictures are Build and Recruit all, as in
    // the original: no second (text) button for them (the player's note: buildings have their own).
    const extraLeft = left.filter(([t]) => t !== "Build" && t !== "Recruit all");
    // No room beside the town (a 4:3 tablet): the same choices behind one button over the scene's corner.
    if (room < 90) {
      const items = [...extraLeft, ...right];
      const b = await textButton(tr("Town"), 110, 40, async () => {
        const i = await choiceBox(town.modals, said(o.name) ?? tr("Town"), items.map(([text]) => tr(text)), Math.max(0, o.owner));
        if (i >= 0) items[i][1]();
      });
      b.position.set(800 - 110 - 8, 56);
      town.touch.addChild(b);
      return;
    }
    // Each button 1.5 times the game's pixels, as wide as the room allows.
    const k = 1.5;
    const w = Math.min(160, Math.floor((room - 20) / k));
    const h = 40;
    // The buildings as their pictures (the hall's tiles, as the phone's bar), a text button only without one.
    const icon = await barIcons(town.world!, o);
    const place = async (items: [string, () => void][], x: number, fromBottom: boolean, pictures: boolean) => {
      const gap = h * k + 12;
      const top = fromBottom ? 600 - 12 - items.length * gap : (600 - items.length * gap) / 2;
      for (const [i, [text, fn]] of items.entries()) {
        const art = pictures ? await icon(text, fn) : null;
        // (A word too long for the big font in the room: the medium one.)
        const b = art ?? (await textButton(said(text), w, h, fn, label(tr(text), "bigfont", WHITE).width > w - 8 ? "medfont" : "bigfont"));
        if (art) {
          art.label = `button: ${text}`;
          art.scale.set(Math.min((h * k) / (art.height / art.scale.y), (room - 20) / (art.width / art.scale.x)));
        } else b.scale.set(k);
        b.position.set(Math.round(x - b.width / 2), Math.round(top + i * gap + (h * k - b.height) / 2));
        town.touch.addChild(b);
      }
    };
    await Promise.all([place(extraLeft, -room / 2, false, true), place(right, 800 + room / 2, true, true), this.resources(s.players[o.owner]?.resources ?? [], room)]);
  }

  /** Touch layout: the treasury down the right-hand room, big enough to read (the bottom bar's numbers are tiny on a phone). */
  private async resources(res: number[], room: number) {
    const icons = (await loadDef("resource.def")).get(0) ?? [];
    const c = new Container();
    let y = 0;
    for (const i of [6, 0, 2, 1, 3, 4, 5]) {
      const f = icons[i];
      if (f) c.addChild(Object.assign(new Sprite(f.texture), { x: 0, y, scale: { x: 0.75, y: 0.75 } }));
      const t = label(said(String(res[i] ?? 0)), "medfont", WHITE);
      t.scale.set(1.5);
      t.position.set(36, y + 2);
      c.addChild(t);
      y += 36;
    }
    // Narrow room (a 4:3 tablet): smaller, so 50000 gold still fits beside the town.
    const fit = Math.min(1, (room - 12) / c.width);
    c.scale.set(fit);
    c.position.set(800 + Math.max(6, room / 2 - (70 * fit)), 70);
    if (c.x + c.width > 800 + room - 4) c.x = 800 + room - 4 - c.width;
    this.town.touch.addChild(c);
  }
}
