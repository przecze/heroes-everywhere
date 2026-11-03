// Release build: no play log for notes.
export function logPlay(_what: string) {}
export function logAction(_msg: { t: string }) {}
export function setReplaySource(_fn: () => unknown) {}
