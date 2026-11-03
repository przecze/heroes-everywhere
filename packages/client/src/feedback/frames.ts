// Release build: no freeze recorder.
import type { Application } from "pixi.js";
export const freezeLines = (): string[] => [];
export function takeFreezes(): string[] | undefined {
  return undefined;
}
export function watchFrames(_app: Application) {}
