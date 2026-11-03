// The original's Bink / Smacker videos (converted to WebM by the dev server) as a Pixi sprite:
// clips play in turn, the last one loops. Frames are copied into a canvas texture.
import { settings } from "../settings.ts";
import { type Container, Sprite, Texture } from "pixi.js";

/** Plays the clips in turn, looping the last one, or (with `onEnd`) once through and then calls it. */
export function videoSprite(clips: string[], width: number, height: number, owner: Container, onEnd?: () => void): Sprite {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  let clip = 0;
  video.src = `/video/${clips[0]}.webm`;
  video.loop = clips.length === 1 && !onEnd;
  video.addEventListener("ended", () => {
    if (onEnd && clip === clips.length - 1) return onEnd();
    clip = Math.min(clip + 1, clips.length - 1);
    video.src = `/video/${clips[clip]}.webm`;
    video.loop = clip === clips.length - 1 && !onEnd;
    void video.play().catch(() => {});
  });
  void video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  // System Options' Video Quality: smoothed, or the clip's own pixels.
  const high = settings().videoQuality !== "low";
  ctx.imageSmoothingEnabled = high;
  const texture = Texture.from(canvas);
  texture.source.scaleMode = high ? "linear" : "nearest";
  const sprite = new Sprite(texture);
  let raf = 0;
  const pump = () => {
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, width, height);
      texture.source.update();
    }
    raf = requestAnimationFrame(pump);
  };
  raf = requestAnimationFrame(pump);
  owner.on("destroyed", () => {
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute("src");
  });
  return sprite;
}

/**
 * Plays a clip once at its own size over `owner` at (x, y) (the spellbook's page turns), then takes
 * itself away. Missing videos simply don't show.
 */
export function playOnce(clip: string, owner: Container, x: number, y: number) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = `/video/${clip}.webm`;
  let sprite: Sprite | null = null;
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute("src");
    if (sprite && !sprite.destroyed) sprite.destroy({ texture: true, textureSource: true });
    sprite = null;
  };
  video.addEventListener("loadeddata", () => {
    if (owner.destroyed) return stop();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    const texture = Texture.from(canvas);
    sprite = Object.assign(new Sprite(texture), { x, y });
    owner.addChild(sprite);
    const pump = () => {
      if (!sprite || sprite.destroyed) return;
      ctx.drawImage(video, 0, 0);
      texture.source.update();
      raf = requestAnimationFrame(pump);
    };
    pump();
  });
  video.addEventListener("ended", stop);
  video.addEventListener("error", stop);
  owner.on("destroyed", stop);
  void video.play().catch(stop);
}
