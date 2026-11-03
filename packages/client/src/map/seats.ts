// Hot seat's Players window (2026-10-24: a party around one screen, someone has to leave early and
// the others play on): each colour in the game, a person's or the computer's, and a tap hands it over
// either way, from where it stands. Not in the original (EXTRAS hotSeatSwap); never in a multiplayer
// game, where a colour is its player's.
import { PLAYER_NAMES } from "@heroes/core";
import { playerSwatch as swatch } from "../assets.ts";
import { dialogBacking } from "../chrome/look.ts";
import { tr } from "../i18n/index.ts";

export interface SeatsHost {
  /** The game's colours as this screen knows them. */
  players: () => { color: number; controller: "human" | "ai" | "none"; alive: boolean }[];
  /** Hands the colour to the computer or to a person at the screen. */
  set: (player: number, controller: "human" | "ai") => void;
}

let panel: HTMLDivElement | null = null;
let host: SeatsHost | null = null;


function render() {
  if (!panel || !host) return;
  const players = host.players().filter((p) => p.controller !== "none" && p.alive);
  const people = players.filter((p) => p.controller === "human").length;
  panel.innerHTML = `<div class="head"><b>${tr("Players")}</b><button data-x data-ico="ok">${tr("Close")}</button></div>
    <div class="sub">${tr("Someone has to leave? The computer plays their colour from where it stands, and the rest of you play on. Give it back to a person at any time.")}</div>
    ${players
      .map((p) => {
        const human = p.controller === "human";
        // (The last person at the screen keeps playing: else the computer would play the game out alone.)
        const last = human && people < 2;
        return `<div class="row"><span>${swatch(p.color)}${tr(PLAYER_NAMES[p.color])} · ${human ? tr("Human") : tr("Computer")}</span>${
          last ? "" : `<button data-seat="${p.color}" data-to="${human ? "ai" : "human"}" data-ico="swap">${human ? tr("To the computer") : tr("To a person")}</button>`
        }</div>`;
      })
      .join("")}`;
  panel.querySelector("[data-x]")?.addEventListener("click", closeSeats);
  panel.querySelectorAll<HTMLButtonElement>("[data-seat]").forEach((b) =>
    b.addEventListener("click", () => {
      host?.set(Number(b.dataset.seat), b.dataset.to === "ai" ? "ai" : "human");
      closeSeats();
    }),
  );
}

export function openSeats(h: SeatsHost) {
  host = h;
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "townPanel lobbyPanel";
    void dialogBacking();
    panel.addEventListener("keydown", (e) => e.key === "Escape" && closeSeats());
    document.body.appendChild(panel);
  }
  panel.hidden = false;
  render();
}

export function closeSeats() {
  if (panel) panel.hidden = true;
}
