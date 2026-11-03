// Release build: no feedback notes.
export const localizeFeedback = () => {};
export function setupFeedback(_app: unknown, _getState: () => unknown) {}
export const setFeedbackMeta = (fn: () => Record<string, unknown>): (() => Record<string, unknown>) => fn;
export const claimFKey = (..._args: unknown[]) => false;
