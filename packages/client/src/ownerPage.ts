// Release build: no owner pages.
export function showOwnerPage(..._args: unknown[]) {
  location.hash = "#menu";
}
