// The page's own markup (index.html: the page menu, Feedback, the splash) in the interface's language.
// Each text node and title / placeholder keeps its English (the key) so the language can change again.
import { tr } from "./index.ts";

const ATTRS = ["title", "placeholder", "aria-label"] as const;
const english = new WeakMap<Node, string>();
const englishAttr = new WeakMap<Element, Record<string, string>>();

/** Puts every text under `root` that has a translation into the current language. */
export function localizeDom(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // A text written later by the code (a status, a count) isn't the markup's: left alone.
    if (n.parentElement?.closest("script, style, textarea, [data-no-i18n]")) continue;
    const en = english.get(n) ?? n.textContent ?? "";
    // The words without a leading symbol ("🎤 Listening…", "☰ drag to move").
    const core = en.trim().replace(/^[^A-Za-z]+/, "");
    if (!/[A-Za-z]{2}/.test(core)) continue;
    const out = tr(core);
    if (out === core && !english.has(n)) continue;
    english.set(n, en);
    n.textContent = en.replace(core, out);
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const a of ATTRS) {
      const kept = englishAttr.get(el)?.[a];
      const en = kept ?? el.getAttribute(a);
      if (!en || !/[A-Za-z]{2}/.test(en)) continue;
      const out = tr(en);
      if (out === en && kept === undefined) continue;
      englishAttr.set(el, { ...englishAttr.get(el), [a]: en });
      el.setAttribute(a, out);
    }
  }
}
