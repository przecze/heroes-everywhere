import type { AdventureState } from "@heroes/core";
import type { ClientMessage, ServerMessage } from "@heroes/server";
import serverWorkerUrl from "virtual:heroes-server-worker";
import { lang, tr } from "./i18n/index.ts";
import { retryNotice, setRetryText } from "./net.ts";

setRetryText(() => tr("Connection trouble: trying again…"));

/** What the UI talks to; backed by a local worker now, a WebSocket for multiplayer later. */
export interface Connection {
  /** `seat`: who is sending (hot seat: the player at the screen); left out, the first human. */
  send(msg: ClientMessage, seat?: number): void;
  /** `to`: the seat a message is meant for (each human's own view), undefined for everyone. */
  onMessage(cb: (msg: ServerMessage, to?: number, full?: AdventureState) => void): void;
}

export function localConnection(): Connection {
  const worker = new Worker(`${serverWorkerUrl}${serverWorkerUrl.includes("?") ? "&" : "?"}lang=${lang()}`, { type: "module" });
  // (The worker retrying a download: the page's notice.)
  worker.addEventListener("message", (e: MessageEvent<{ net?: number }>) => e.data.net !== undefined && retryNotice(e.data.net));
  return {
    send: (msg, seat) => worker.postMessage({ msg, seat }),
    onMessage: (cb) =>
      worker.addEventListener("message", (e: MessageEvent<{ msg: ServerMessage; to?: number; full?: AdventureState; net?: number }>) => {
        if (e.data.net === undefined) cb(e.data.msg, e.data.to, e.data.full);
      }),
  };
}
