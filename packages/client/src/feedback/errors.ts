// Release build: errors go to the browser's console only.
export type ErrorKind = "error" | "rejection" | "bug" | "refusal" | "client";
export function setErrorSnapshot(_fn: () => unknown) {}
export function reportError(kind: ErrorKind, message: string, detail?: string): boolean {
  console.error(`[${kind}] ${message}`, detail ?? "");
  return false;
}
