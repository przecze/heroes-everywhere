import { loadDefPlayer, textureCanvas } from "../assets.ts";
import { dialogBacking } from "../chrome/look.ts";

/** A canvas as a short `blob:` URL (the pieces repeat in every panel's background: a short name is cheap for the page to match, a data URL is not). */
const blobUrl = (canvas: HTMLCanvasElement) => new Promise<string>((ok, no) => canvas.toBlob((b) => (b ? ok(`url(${URL.createObjectURL(b)})`) : no(new Error("no picture"))), "image/png"));

/**
 * The original's window frame (DIALGBOX.DEF, in a player's colour) and leather (DIBOXBCK.PCX) for the page's own
 * panels (chat, My notes, How to…, Layouts…, the pop-ups): puts the pieces on the page as CSS custom properties,
 * and `html.framed` once they are in. panels.css draws `.gameFrame` panels from them: the four edge strips full
 * length, the four corners over them, the leather inside (docs/visual-language.md §1). Without the game files
 * nothing is set and the panels keep their plain brown.
 */
export async function installFrame(player = 1) {
  try {
    const [def, leather] = await Promise.all([loadDefPlayer("dialgbox.def", player), dialogBacking()]);
    const f = def.get(0);
    if (!f || f.length < 8 || !leather) return;
    const root = document.documentElement.style;
    // The pieces, in the DEF's order: corners TL TR BL BR, edges L R T B.
    const names = ["tl", "tr", "bl", "br", "l", "r", "t", "b"];
    await Promise.all(
      names.map(async (n, i) => {
        const { texture } = f[i];
        root.setProperty(`--fr-${n}`, await blobUrl(textureCanvas(texture)));
        root.setProperty(`--fr-${n}-w`, String(texture.width));
        root.setProperty(`--fr-${n}-h`, String(texture.height));
      }),
    );
    // How far in the leather starts: the thickest edge.
    root.setProperty("--fr-edge", String(Math.max(f[4].texture.width, f[5].texture.width, f[6].texture.height, f[7].texture.height)));
    // The leather, as a short name too (dialogBacking gives a data URL).
    const img = new Image();
    img.src = leather.slice(4, -1);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    root.setProperty("--menu-bg", await blobUrl(c));
    document.documentElement.classList.add("framed");
  } catch {
    // no game files: the plain panels
  }
}
