// The page's chrome: what is ours around the game rather than the game's own screens. The ☰ menu
// (pageMenu.ts: the list in index.html, opened and closed; iconMenu.ts: the same as a panel of icon
// tiles, EXTRAS iconMenu), the windows it opens (settingsWindow.ts: Settings and the Additions beyond
// HotA; layouts.ts; notifyPanel.ts), and their shared look (look.ts: the leather, the page window,
// Escape). The Feedback button is feedback/'s, the chat room community/'s; the settings themselves
// are ../settings.ts. Other modules import the piece they need (pageMenu.ts's setGameOptions /
// setSeats / openPageMenu, look.ts's dialogBacking / pageWindow); main.ts calls setupChrome once.
import { isMuted, setMuted } from "../audio.ts";
import { canFullscreen, enterFullscreen, reloadPage, turnScreen } from "../fullscreen.ts";
import { tr } from "../i18n/index.ts";
import { offlinePanel } from "../offline.ts";
import { extra, onSettings } from "../settings.ts";
import { installFrame } from "../ui/htmlFrame.ts";
import { watchIcons } from "../ui/htmlIcons.ts";
import { setupTurn } from "../ui/turn.ts";
import { setupIconMenu } from "./iconMenu.ts";
import { toggleLayouts } from "./layouts.ts";
import { toggleNotifications } from "./notifyPanel.ts";
import { setupPageMenu } from "./pageMenu.ts";
import { setRefit, toggleOptions } from "./settingsWindow.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Wires the menu's items (index.html) to what they open; `refit` lays the game out again (the interface size). */
export function setupChrome(refit: () => void) {
  setRefit(refit);
  setupTurn($<HTMLButtonElement>("turnToggle"));
  $("options").onclick = () => toggleOptions();
  $("menuLayouts").onclick = () => toggleLayouts();
  const showLayouts = () => ($("menuLayouts").hidden = !extra("layoutSwitcher"));
  showLayouts();
  onSettings(showLayouts);
  $("offline").onclick = () => void offlinePanel();
  setupPageMenu();
  setupIconMenu();
  watchIcons();
  void installFrame();
  $("menuFull").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await enterFullscreen();
    } catch {
      // not allowed here
    }
  };
  $("menuFull").hidden = !canFullscreen();
  // Phones and tablets: one tap to the other orientation (fullscreen.ts turnScreen).
  $("menuTurn").hidden = !matchMedia("(pointer: coarse)").matches;
  $("menuTurn").onclick = () => void turnScreen();
  // (Not in every build: the open-source release has no notifications.)
  const notifyButton = document.getElementById("menuNotify");
  if (notifyButton) notifyButton.onclick = () => void toggleNotifications();
  $("menuReload").onclick = () => reloadPage();
  $("menuVersion").textContent = typeof __BUILT__ === "string" ? tr("Version %1", __BUILT__.replace("T", " ")) : "";
  const mute = $<HTMLButtonElement>("mute");
  const showMute = () => (mute.textContent = isMuted() ? tr("Sound: off") : tr("Sound: on"));
  mute.onclick = () => {
    setMuted(!isMuted());
    showMute();
  };
  mute.hidden = false;
  showMute();
}

declare const __BUILT__: string | undefined;
