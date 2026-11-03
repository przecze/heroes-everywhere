// What an artifact's popup says: its name and the game's description, a Spell Scroll's "[spell name]"
// filled in with the spell it holds (the hero's scrolls, in the order found).
import type { Hero } from "@heroes/core";
import { type Text, said, fmt } from "../i18n/index.ts";

export function artifactText(data: { artifacts: { name: string; description?: string }[]; spells?: ({ name: string } | undefined)[] }, art: number, hero?: Hero): Text {
  const a = data.artifacts[art];
  const names = (hero?.scrolls ?? []).map((id) => data.spells?.[id]?.name).filter(Boolean);
  const description = said((a?.description ?? "").replace("[spell name]", names.length ? names.join(", ") : "a"));
  return fmt`${said(a?.name) ?? said("")}\n\n${description}`;
}
