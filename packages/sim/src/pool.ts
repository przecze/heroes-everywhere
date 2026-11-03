// Simulations spread over the machine's cores with worker threads (one game, battle or scene per job;
// each worker loads the game data once). Results come back in the jobs' order, so a run's output is
// the same whatever the number of threads.
//   JOBS=<n>: threads to use (default: every core).
import { availableParallelism } from "node:os";
import { SHARE_ENV, Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export { isMainThread, workerData };

/** Threads to use: JOBS=<n>, or every core. */
export const threads = () => Math.max(1, Number(process.env.JOBS) || availableParallelism());

/**
 * Runs each job through `serve`'s function in `file` (a script that calls serve() when not the main
 * thread), on up to `n` worker threads, handing out the next job as each finishes.
 */
export async function pool<J, R>(file: string | URL, jobs: J[], n = threads(), data: Record<string, unknown> = {}): Promise<R[]> {
  const out: R[] = new Array(jobs.length);
  let next = 0;
  const run = () =>
    new Promise<void>((done, fail) => {
      const w = new Worker(file, { workerData: { pooled: true, ...data }, env: SHARE_ENV });
      const give = () => (next < jobs.length ? w.postMessage({ i: next, job: jobs[next++] }) : void w.terminate().then(() => done()));
      w.on("message", (m: { i: number; result?: R; error?: string }) => {
        if (m.error !== undefined) return void w.terminate().then(() => fail(new Error(m.error)));
        out[m.i] = m.result!;
        give();
      });
      w.on("error", fail);
      w.once("online", give);
    });
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, run));
  return out;
}

/** In a worker started by pool(): answers each job with f's result. */
export function serve<J, R>(f: (job: J) => R | Promise<R>) {
  parentPort!.on("message", async ({ i, job }: { i: number; job: J }) => {
    try {
      parentPort!.postMessage({ i, result: await f(job) });
    } catch (e) {
      parentPort!.postMessage({ i, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  });
}

/**
 * Runs a script once per argument list, on up to `n` worker threads, and gives back what each run
 * printed (stdout and stderr together) and its exit code (null when it ran out of time).
 */
export async function runScripts(file: string | URL, argvs: string[][], n = threads(), timeoutSec = 0, onDone?: (k: number) => void): Promise<{ out: string; code: number | null }[]> {
  const results: { out: string; code: number | null }[] = new Array(argvs.length);
  let next = 0;
  let finished = 0;
  const one = (k: number) =>
    new Promise<void>((done) => {
      const w = new Worker(file, { argv: argvs[k], env: SHARE_ENV, stdout: true, stderr: true });
      let out = "";
      let timedOut = false;
      w.stdout.on("data", (d) => (out += d));
      w.stderr.on("data", (d) => (out += d));
      w.on("error", (e) => (out += `\n${e instanceof Error ? (e.stack ?? e.message) : e}\n`));
      const timer = timeoutSec ? setTimeout(() => ((timedOut = true), w.terminate()), timeoutSec * 1000) : undefined;
      // (Done once it has exited and everything it printed has come through.)
      let left = 3;
      let exit: number | null = null;
      const end = () => {
        if (--left) return;
        clearTimeout(timer);
        results[k] = { out, code: timedOut ? null : exit };
        onDone?.(++finished);
        done();
      };
      w.stdout.on("end", end);
      w.stderr.on("end", end);
      w.on("exit", (code) => ((exit = code), end()));
    });
  await Promise.all(
    Array.from({ length: Math.min(n, argvs.length) }, async () => {
      while (next < argvs.length) await one(next++);
    }),
  );
  return results;
}

/** Whether this is a pool() worker (not one runScripts started). */
export const pooled = () => !isMainThread && (workerData as { pooled?: boolean } | undefined)?.pooled === true;
