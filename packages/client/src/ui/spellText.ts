
import { type Text, fmt, said } from "../i18n/index.ts";// What a spell's popup says, everywhere it shows (the spellbook, the Mage Guild, research, message pictures): its name as
// the title and the description at the hero's mastery, as VCMI's CSpellWindow ("{%s}\n\n%s").
export function spellText(sp: { name: string; text: string[] }, mastery = 0, more = ""): Text {
  return fmt`{${said(sp.name)}}\n\n${said(sp.text[mastery]) ?? said(sp.text[0]) ?? said("")}${said(more)}`;
}
