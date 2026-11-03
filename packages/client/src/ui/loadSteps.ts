// The real steps of a game being set up, for the loading screen's live checklist (EXTRAS loadSteps):
// each step is told when it starts and ends, so the screen can show a spinner, then a tick and the
// milliseconds it took. Steps whose times overlap really ran side by side; they are marked as parallel.
import { extra } from "../settings.ts";

export interface LoadStep {
  id: string;
  label: string;
  start: number;
  end?: number;
  failed?: boolean;
}

let steps: LoadStep[] = [];
let listener: (() => void) | null = null;

/** A new load begins: the list starts empty. */
export function resetSteps() {
  steps = [];
  listener?.();
}

/** The loading screen redraws its list whenever a step starts or ends. */
export function onSteps(fn: (() => void) | null) {
  listener = fn;
}

export const stepsWanted = () => extra("loadSteps");
export const allSteps = (): readonly LoadStep[] => steps;

/** Times `p` as one step (the same id twice keeps the first). Returns `p` unchanged. */
export function track<T>(id: string, label: string, p: Promise<T>): Promise<T> {
  if (steps.some((s) => s.id === id)) return p;
  const step: LoadStep = { id, label, start: performance.now() };
  steps.push(step);
  listener?.();
  const end = (failed: boolean) => {
    step.end = performance.now();
    step.failed = failed;
    listener?.();
  };
  p.then(() => end(false), () => end(true));
  return p;
}

/** Does this step's time overlap another's (they ran in parallel)? */
export function parallelWith(s: LoadStep, now = performance.now()): boolean {
  return steps.some((o) => o !== s && o.start < (s.end ?? now) && s.start < (o.end ?? now));
}
