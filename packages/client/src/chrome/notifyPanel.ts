// ☰ → Notifications: whether this device can ring, whether the server knows it, and a test that
// rings it now. Written for the installed app, where there is no browser bar to look at: a lost
// subscription (the permission was reset, the app reinstalled) is told here and mended with one tap.
import { tr } from "../i18n/index.ts";
import { type PushStatus, pushStatus, repairPush, sendTestPush } from "../notify.ts";
import { type PageWindow, pageWindow } from "./look.ts";

let panel: PageWindow | null = null;

const permissionText = (s: PushStatus) =>
  s.permission === "granted" ? tr("allowed") : s.permission === "denied" ? tr("blocked in the browser's settings for this site") : tr("not asked yet");

/** The panel: three facts and the two buttons that follow from them. */
export async function toggleNotifications() {
  if (panel) return panel.close();
  const win = (panel = pageWindow("notifyPanel", tr("Notifications"), `<div data-body></div><div data-mail></div>`, { onClose: () => (panel = null) }));
  const box = win.box.querySelector<HTMLElement>("[data-body]")!;
  const render = (s: PushStatus, note = "") => {
    if (panel !== win) return;
    const yes = (v: boolean | null) => (v === null ? tr("unknown (no connection)") : v ? tr("yes") : tr("no"));
    const ok = s.permission === "granted" && s.subscribed && s.onServer === true;
    box.innerHTML = `${
        s.supported
          ? `<div class="row"><span>${tr("Permission")}</span><b>${permissionText(s)}</b></div>
      <div class="row"><span>${tr("This device is subscribed")}</span><b>${yes(s.subscribed)}</b></div>
      <div class="row"><span>${tr("The server knows this device")}</span><b>${yes(s.onServer)}</b></div>
      <div class="row hint">${ok ? tr("All set. Send a test to see it arrive.") : s.permission === "denied" ? tr("Notifications are blocked: allow them in the browser's (or the app's) site settings, then tap Repair.") : tr("Tap Repair: it asks for permission and subscribes this device again.")}</div>
      <div class="row buttons"><button data-fix data-ico="swap">${ok ? tr("Subscribe again") : tr("Repair")}</button><button data-test data-ico="bell">${tr("Send test")}</button></div>
      <div class="row hint" data-note>${note}</div>`
          : `<div class="row hint">${/iPhone|iPad/.test(navigator.userAgent) ? tr("Add the game to the home screen first and open it from there.") : tr("This browser can't show notifications.")}</div>`
      }`;
    const say = (t: string) => (box.querySelector("[data-note]")!.textContent = t);
    box.querySelector("[data-fix]")?.addEventListener("click", async () => {
      say(tr("Working…"));
      try {
        await repairPush();
        render(await pushStatus(), tr("Subscribed ✓"));
      } catch (err) {
        render(await pushStatus(), `${tr("Not subscribed")}: ${err instanceof Error ? err.message : err}`);
      }
    });
    box.querySelector("[data-test]")?.addEventListener("click", async () => {
      say(tr("Sending…"));
      try {
        const t = await sendTestPush();
        if (!t.known) return say(tr("The server doesn't know this device: tap Repair."));
        if (!t.rung) return say(`${tr("The push service refused it")} (${t.results.map((r) => `${r.host} ${r.status}`).join(", ") || tr("no answer")}). ${tr("Tap Repair.")}`);
        say(tr("Sent ✓ it should appear in a few seconds. If it doesn't, check the app's notification settings in Android."));
      } catch (err) {
        say(`${tr("Not sent")}: ${err instanceof Error ? err.message : err}`);
      }
    });
  };
  render(await pushStatus());
  // (Below the push rows, which a Repair draws again.)
  void emailSection(win.box.querySelector<HTMLElement>("[data-mail]")!);
}

interface EmailState {
  configured: boolean;
  address: string;
  confirmed: boolean;
  mailed?: boolean;
}

/** Email as the second channel: an address, a link mailed to confirm it, then digests (emailer.ts). Kept below the push rows. */
async function emailSection(box: HTMLElement) {
  const post = (body: unknown) => fetch("/__email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const show = (st: EmailState | null, note = "") => {
    if (!panel?.box.contains(box)) return;
    box.querySelector("[data-email]")?.remove();
    const sec = document.createElement("div");
    sec.dataset.email = "";
    const line = !st ? tr("The server can't be reached.") : !st.configured ? tr("Email isn't set up on the server yet.") : st.address ? (st.confirmed ? tr("Digests go to this address (at most one every 15 minutes). Chat is never mailed.") : tr("Open the link we mailed to confirm this address.")) : tr("Push can be unreliable on Android: add an email address to get the same news as a digest.");
    sec.innerHTML = `<div class="row"><span>${tr("Email")}</span></div>
      <div class="row"><input type="email" data-addr inputmode="email" autocomplete="email" placeholder="you@example.com" value="${(st?.address ?? "").replace(/[&<>"]/g, "")}" style="flex:1;min-width:0;font:inherit;font-size:16px;padding:8px"></div>
      <div class="row buttons"><button data-save data-ico="ok">${tr("Save")}</button>${st?.confirmed ? `<button data-mailtest data-ico="mail">${tr("Send test")}</button>` : ""}${st?.address ? `<button data-remove data-ico="remove">${tr("Remove email")}</button>` : ""}</div>
      <div class="row hint" data-emailnote>${note || line}</div>`;
    box.appendChild(sec);
    const say = (t: string) => (sec.querySelector("[data-emailnote]")!.textContent = t);
    const addr = sec.querySelector<HTMLInputElement>("[data-addr]")!;
    sec.querySelector("[data-save]")!.addEventListener("click", async () => {
      const r = await post({ address: addr.value }).catch(() => null);
      if (r?.status === 400) return say(tr("That doesn't look like an email address."));
      const st2 = r?.ok ? ((await r.json()) as EmailState) : null;
      show(st2, st2?.mailed ? tr("Mailed a link: open it to confirm.") : st2 && !st2.configured ? tr("Email isn't set up on the server yet.") : tr("Saved, but the mail could not be sent."));
    });
    sec.querySelector("[data-remove]")?.addEventListener("click", async () => {
      await post({ address: "" }).catch(() => null);
      show(await load());
    });
    sec.querySelector("[data-mailtest]")?.addEventListener("click", async () => {
      say(tr("Sending…"));
      const r = await fetch("/__email/test", { method: "POST" }).catch(() => null);
      say(r?.ok && ((await r.json()) as { sent: boolean }).sent ? tr("Sent ✓ check your inbox (and the spam folder).") : tr("Not sent"));
    });
  };
  const load = async () => (await fetch("/__email", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<EmailState>) : null)).catch(() => null)) ;
  show(await load());
}
