import type { ChatLine, HostClientMessage, HostServerMessage, Look, MyGame, RoomInfo, SeatClock } from "../../host/src/protocol.ts";
import type { GameReport, ReplayStep } from "@heroes/server";
import type { Connection } from "./connection.ts";
import { lang } from "./i18n/index.ts";

export type { ChatLine, Look, MyGame, RoomInfo, SeatClock };

/** WebSocket link to the multiplayer host: lobby messages plus a game Connection. */
/** The multiplayer socket's last opens, closes and errors, and the newest link's state (a feedback note carries them). */
const socketLog: string[] = [];
let newest: WebSocket | null = null;
export function socketState(): { state?: string; log?: string[] } {
  if (!newest) return {};
  return { state: ["connecting", "open", "closing", "closed"][newest.readyState], log: socketLog.slice() };
}

export class MpLink implements Connection {
  private ws: WebSocket;
  private readonly ready: Promise<void>;
  private gameHandlers: ((msg: import("@heroes/server").ServerMessage) => void)[] = [];
  onRoom: ((room: RoomInfo, you: string) => void) | null = null;
  onPeek: ((room: RoomInfo, mine?: string, you?: string) => void) | null = null;
  onMine: ((games: MyGame[]) => void) | null = null;
  onError: ((message: string, code?: import("../../host/src/protocol.ts").LobbyErrorCode) => void) | null = null;
  onClose: (() => void) | null = null;
  onClock: ((seats: Record<number, SeatClock>) => void) | null = null;
  onChat: ((lines: ChatLine[], history?: boolean) => void) | null = null;
  onRooms: ((rooms: RoomInfo[]) => void) | null = null;
  /** Back in a game played by notification: what happened since we were last here. */
  onRecap: ((reports: GameReport[], since?: number, replay?: ReplayStep[]) => void) | null = null;
  /** Where an ally is looking, and an ally's battle to watch (following their turn: map/follow.ts). */
  onLook: ((seat: number, look: Look) => void) | null = null;
  onWatch: ((seat: number, msg: import("@heroes/server").ServerMessage) => void) | null = null;

  constructor() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/mp`);
    newest = this.ws;
    for (const t of ["open", "close", "error"] as const)
      this.ws.addEventListener(t, (e) => {
        socketLog.push(`${new Date().toISOString().slice(11, 19)} ${t}${e instanceof CloseEvent ? ` ${e.code}${e.reason ? ` ${e.reason}` : ""}` : ""}`);
        if (socketLog.length > 8) socketLog.shift();
      });
    this.ready = new Promise((resolve) => this.ws.addEventListener("open", () => resolve(), { once: true }));
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data) as HostServerMessage;
      if (m.t === "mpRoom") this.onRoom?.(m.room, m.you);
      else if (m.t === "mpPeek") this.onPeek?.(m.room, m.mine, m.you);
      else if (m.t === "mpMine") this.onMine?.(m.games);
      else if (m.t === "mpError") this.onError?.(m.message, m.code);
      else if (m.t === "mpClock") this.onClock?.(m.seats);
      else if (m.t === "mpChat") this.onChat?.(m.lines, m.history);
      else if (m.t === "mpRooms") this.onRooms?.(m.rooms);
      else if (m.t === "mpRecap") this.onRecap?.(m.reports, m.since, m.replay);
      else if (m.t === "mpLook") this.onLook?.(m.seat, m.look);
      else if (m.t === "mpWatch") this.onWatch?.(m.seat, m.msg);
      else if (m.t === "game") for (const h of this.gameHandlers) h(m.msg);
    });
    // Out of sight (another tab, the phone locked, the app in the background), the host tells us of our turn
    // with a notification, as if we were away (packages/host rooms.ts looking()).
    const sight = () => this.ws.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ t: "mpHidden", hidden: document.hidden } satisfies HostClientMessage));
    this.ws.addEventListener("open", () => {
      // (The host says our "your turn" pings in the language we speak.)
      this.ws.send(JSON.stringify({ t: "mpLang", lang: lang() } satisfies HostClientMessage));
      if (document.hidden) sight();
    });
    document.addEventListener("visibilitychange", sight);
    this.ws.addEventListener("close", () => {
      document.removeEventListener("visibilitychange", sight);
      this.onClose?.();
    });
  }

  async lobby(m: HostClientMessage) {
    await this.ready;
    this.ws.send(JSON.stringify(m));
  }

  send(msg: import("@heroes/server").ClientMessage) {
    void this.lobby({ t: "game", msg });
  }

  onMessage(cb: (msg: import("@heroes/server").ServerMessage) => void) {
    this.gameHandlers.push(cb);
  }

  /** Resolves once what was sent has left the browser. */
  async flushed() {
    for (let i = 0; i < 40 && this.ws.bufferedAmount > 0; i++) await new Promise((r) => setTimeout(r, 25));
  }

  close() {
    this.ws.close();
  }
}

/** The multiplayer games I'm in (by who I am), asked of the host once; none when it can't be reached in time. */
export function fetchMyGames(timeoutMs = 3000): Promise<MyGame[]> {
  return new Promise((resolve) => {
    let link: MpLink;
    try {
      link = new MpLink();
    } catch {
      return resolve([]);
    }
    const done = (games: MyGame[]) => {
      clearTimeout(timer);
      link.onMine = link.onClose = null;
      link.close();
      resolve(games);
    };
    const timer = setTimeout(() => done([]), timeoutMs);
    link.onMine = (games) => done(games);
    link.onClose = () => done([]);
    void link.lobby({ t: "mpMine" });
  });
}
