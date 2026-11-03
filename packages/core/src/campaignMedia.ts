// Campaign prologue / epilogue videos and music by the number a campaign file stores: the table is made from VCMI's
// and the HotA mod's configs in packages/vcmi-data.
export { CAMPAIGN_VIDEOS, CAMPAIGN_MUSIC } from "../../vcmi-data/src/campaignMedia.ts";

/** A campaign's own video before its first scenario and after its last (VCMI's campaignOverrides: Armageddon's Blade's intro, Song for the Father's end). */
export const CAMPAIGN_INTRO: Record<string, string> = { ab: "h3x1intr" };
export const CAMPAIGN_OUTRO: Record<string, string> = { good3: "endgame" };
