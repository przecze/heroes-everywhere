// What a shot does where it lands, beyond the missile: Magogs' fireball, Liches' death cloud,
// Grenadiers' grenade, and the explosions HotA gives other shooters (its "changed shooting
// visuals"). As VCMI's displaySpellHit for a SPELL_LIKE_ATTACK: the effect on the struck hex at the
// moment the targets flinch, with its sound. HotA's own pictures (from its mod files) come first;
// where they're missing, the original's (SoD's Fireball and Death Cloud).

export interface ShotHit {
  /** Effect DEFs, best first: the first one found is played. */
  defs: string[];
  /** Sounds, matching `defs` (the last one is used past the end). */
  sounds: string[];
  /** Drawn see-through (VCMI's "transparency" for the Death Cloud). */
  alpha?: number[];
}

/** By creature key. */
export const SHOT_HITS: Record<string, ShotHit> = {
  // HotA: Expl_01 with GOGFIREB.wav; SoD: Fireball's C13SPF with SPONTCOMB.
  magog: { defs: ["expl_01.def", "c13spf.def"], sounds: ["GOGFIREB", "SPONTCOMB"] },
  // The Death Cloud's own SP04_ (mostly opaque: half see-through vanished on the battlefield, the owner 2026-11-02 19:04 "too transparent"; 142 x 139: the struck hex and the six round it, so the cloud shows
  // what it hits; The owner, 2026-11-02 17:10: HotA's Expl_05, a hex and a half, read as a single-target shot), with
  // DEATHCLD.wav; Expl_05 (DEATHCLS) only where SP04_ is missing. Liches and Power Liches alike (both have the cloud in HoMM3).
  lich: { defs: ["sp04_.def", "expl_05.def"], sounds: ["DEATHCLD", "DEATHCLS"], alpha: [0.85, 1] },
  powerLich: { defs: ["sp04_.def", "expl_05.def"], sounds: ["DEATHCLD", "DEATHCLS"], alpha: [0.85, 1] },
  halflingGrenadier: { defs: ["expl_07.def"], sounds: ["GRENEXPL"] },
  monk: { defs: ["expl_06.def"], sounds: ["MAGCBLTH"] },
  zealot: { defs: ["expl_06.def"], sounds: ["MAGCBLTH"] },
  iceElemental: { defs: ["c08spw5.def"], sounds: ["ICEELMSH"] },
  stormElemental: { defs: ["expl_02.def"], sounds: ["STORMELM"] },
  beholder: { defs: ["expl_03.def"], sounds: [] },
  evilEye: { defs: ["expl_03.def"], sounds: [] },
  titan: { defs: ["expl_04.def"], sounds: ["MAGCBLTH"] },
  enchanter: { defs: ["c20spx.def"], sounds: ["MAGCBLTH"] },
};
