// The headers every answer of the deployed server carries (serve.ts): what the browser may load and where the page
// may send anything (docs/supply-chain.md). A package in the bundle gone bad could still run in the page, but not
// load code from elsewhere, not send what it finds to a server of its own, not be framed by another site.
//   HEROES_CSP=report   the same policy, only reported (Content-Security-Policy-Report-Only): a way back in a minute if
//                     it ever blocks something the game needs (state/secrets.env, then restart the app)
//   HEROES_CSP=off      no policy at all
// Violations come to POST /__csp (a line in the app's log each, a few a minute at most).
import type { IncomingMessage, ServerResponse } from "node:http";

/** Where the page itself connects beyond its own origin: the live words of voice notes (feedback/scribe.ts) and the
 *  on-device speech model's files (feedback/whisperWorker.ts: Hugging Face, which redirects to its *.hf.co storage). */
const CONNECT = ["https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co"];

export const POLICY = [
  "default-src 'self'",
  // No code from elsewhere and no eval (Pixi's shader code is built without it: main.ts imports pixi.js/unsafe-eval);
  // WebAssembly for the speech model. Inline scripts stay: index.html's two and the owner pages' (served from the server's own code).
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${CONNECT.join(" ")}`,
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /__csp",
].join("; ");

export function securityHeaders(res: ServerResponse) {
  const mode = process.env.HEROES_CSP ?? "on";
  if (mode !== "off") res.setHeader(mode === "report" ? "content-security-policy-report-only" : "content-security-policy", POLICY);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)");
}

/**
 * A page from a build made before the policy (an agent's older upload, a branch preview: their index.html has no
 * integrity marks) gets the policy only as a report: its Pixi still builds shaders with eval, which the policy forbids.
 */
export function oldBuildPolicy(res: ServerResponse, file: string, body: Buffer) {
  const csp = res.getHeader("content-security-policy");
  if (!csp || !file.endsWith(".html") || body.includes('integrity="sha384-')) return;
  res.removeHeader("content-security-policy");
  res.setHeader("content-security-policy-report-only", csp);
}

let reported: number[] = [];
/** A browser's report of something the policy blocked: one log line (at most 10 a minute), nothing kept. */
export function cspReport(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return void ((res.statusCode = 405), res.end());
  let body = "";
  req.on("data", (c) => body.length < 4096 && (body += c));
  req.on("end", () => {
    const now = Date.now();
    reported = reported.filter((t) => now - t < 60_000);
    if (reported.length < 10) {
      reported.push(now);
      try {
        const r = JSON.parse(body)["csp-report"] ?? {};
        console.warn(`[csp] ${r["violated-directive"] ?? r["effective-directive"] ?? "?"} blocked ${String(r["blocked-uri"] ?? "?").slice(0, 200)} on ${String(r["document-uri"] ?? "?").slice(0, 200)}`);
      } catch {
        console.warn("[csp] an unreadable report");
      }
    }
    res.statusCode = 204;
    res.end();
  });
}
