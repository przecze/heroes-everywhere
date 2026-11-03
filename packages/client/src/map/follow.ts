// Multiplayer with allies: while the others take their turns, the screen follows them live, move by
// move: the view goes where an ally walks, their town screen opens when they open it (and shows what
// they build), their battles play out here. A drag, the arrow keys or the minimap let go of it (a
// free camera to look around the map); the Follow control in the HUD (the info box on a desktop, the
// rail's wide button on a touch screen) takes it up again. The host sends where allies look and,
// while we follow, their battles (host rooms.ts mpLook / mpWatch); the walks come with every update.
import { type AdventureState, PLAYER_NAMES, allied } from "@heroes/core";
import type { Look } from "../mp.ts";
import { tr, type Text, said } from "../i18n/index.ts";
import { townHoverName } from "./describe.ts";

/** What the HUD shows of it: following or not, and what the ally followed is doing. */
export interface FollowShown {
  following: boolean;
  caption: Text;
}

export class Follow {
  /** Going after the allies (else the player looks around freely). */
  following = true;
  /** Where each ally looks, as the host last said. */
  readonly looks = new Map<number, Look>();
  /** The ally the view goes after: the one who last did something. */
  lead = -1;
  /** Where the lead last walked to (the view goes back there when following is taken up again). */
  leadAt: { x: number; y: number; z: number } | null = null;
  /** A town screen opened to show an ally's (closed when they close theirs; closing it oneself lets go). */
  town = -1;
  /** That town screen being closed by us, not the player. */
  closing = false;
  /** An ally's battle on screen to watch (its id). */
  battle: number | undefined;
  /** What the host was last told about our following (it sends battles only while we follow). */
  private told: { link: object; on: boolean } | null = null;

  /** An ally did something where we can see it: the view goes after them. */
  acted(s: AdventureState, me: number, owner: number, at: { x: number; y: number; z: number }) {
    if (owner === me || !allied(s, owner, me)) return;
    this.lead = owner;
    this.leadAt = at;
  }

  /** The host's word on where an ally looks. */
  look(seat: number, look: Look) {
    this.looks.set(seat, look);
    if (look.k !== "map") this.lead = seat;
  }

  /** Tells the host whether to send allies' battles, when that changed (a new link starts untold). */
  tell(link: { lobby: (m: { t: "mpFollow"; on: boolean }) => unknown } | null, on: boolean) {
    if (!link || (this.told?.link === link && this.told.on === on)) return;
    this.told = { link, on };
    void link.lobby({ t: "mpFollow", on });
  }

  /** The line the HUD shows for the ally followed: who, and in which town or battle. */
  shown(s: AdventureState, me: number, names: string[], moving: number[]): FollowShown {
    const lead = this.lead >= 0 ? this.lead : (moving.find((p) => p !== me && allied(s, p, me)) ?? -1);
    const name = lead >= 0 ? said(names[lead]) || tr(PLAYER_NAMES[lead]) : said("");
    const look = this.looks.get(lead);
    const town = look?.k === "town" ? s.objects[look.object] : undefined;
    const caption = !name ? said("") : town ? tr("%1 is in %2.", name, townHoverName(town)) : look?.k === "battle" ? tr("%1 is fighting.", name) : tr("%1 is moving…", name);
    return { following: this.following, caption };
  }
}
