// Campaign prologue / epilogue: the scenario's video, its music, and the text scrolling up in
// gold below it; a click (or Enter / Escape) goes on. After VCMI's CPrologEpilogVideo.
import { settings } from "../settings.ts";
import { CAMPAIGN_MUSIC, CAMPAIGN_VIDEOS } from "@heroes/core";
import { Container, Graphics } from "pixi.js";
import { playMusic } from "../audio.ts";
import { label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { videoSprite } from "./video.ts";
import { said } from "../i18n/index.ts";

/**
 * A film fills the screen, black all round it, at its own size whatever the layout: never a window among the page's
 * (upright the campaign's opening showed small and to one side over the map: the owner, 2026-10-26 "why not movie fs").
 */
export const FILM = { own: true, backdrop: 0x000000 } as const;

export async function prologue(modals: Modals, p: { video: number; music: number; text: string }): Promise<void> {
  const win = new Container();
  win.addChild(new Graphics().rect(0, 0, 800, 600).fill(0x000000));
  const clips = CAMPAIGN_VIDEOS[p.video];
  if (clips?.length) win.addChild(videoSprite(clips, 800, 600, win));
  if (CAMPAIGN_MUSIC[p.music]) void playMusic(`${CAMPAIGN_MUSIC[p.music]}.mp3`, true);
  // The text: big gold font, scrolling up a pixel at a time in the band below the video.
  const text = label(said(p.text), "bigfont", [229, 205, 119], "center", 600);
  const band = new Container();
  band.position.set(100, 500);
  const mask = new Graphics().rect(0, 0, 600, 100).fill(0xffffff);
  band.addChild(text, mask);
  band.mask = mask;
  // System Options' Video Subtitles: the text under the video.
  band.visible = settings().subtitles;
  text.y = 25;
  win.addChild(band);
  let scroll = 0;
  const timer = setInterval(() => {
    if (text.height - 50 > scroll) text.y = 25 - ++scroll;
  }, 150);
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => {
      clearInterval(timer);
      close();
      resolve();
    };
    win.eventMode = "static";
    win.on("pointertap", done);
    close = modals.show(win, { ...FILM, onKey: (k) => (k === "Enter" || k === "Escape" || k === " " ? done() : undefined, true) });
  });
}

/** A whole-screen video played once through (a campaign's intro or ending); a click or a key skips it. */
export function fullVideo(modals: Modals, clip: string): Promise<void> {
  const win = new Container();
  win.addChild(new Graphics().rect(0, 0, 800, 600).fill(0x000000));
  return new Promise((resolve) => {
    let close = () => {};
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      close();
      resolve();
    };
    win.addChild(videoSprite([clip], 800, 600, win, done));
    win.eventMode = "static";
    win.on("pointertap", done);
    close = modals.show(win, { ...FILM, onKey: (k) => (k === "Enter" || k === "Escape" || k === " " ? done() : undefined, true) });
  });
}
