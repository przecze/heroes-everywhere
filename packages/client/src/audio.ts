import { quick } from "./speed.ts";
import { extra } from "./settings.ts";
import { logPlay } from "./feedback/recent.ts";
import { decodeWav } from "@heroes/formats";
import { fetchRes } from "./assets.ts";
import { outsidePage } from "./pages.ts";

// Browsers only allow audio after a user gesture; the context resumes on the first click/key.
const ctx = new AudioContext();
/** Set by the first gesture. Before it, effects are dropped (otherwise they'd all play at once later). */
let unlocked = false;
const resume = () => {
  // Older iOS only lets a context make sound once something started inside the gesture: a silent sample.
  if (!unlocked) {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start();
  }
  unlocked = true;
  // (iOS also "interrupts" the context after a call or a trip to the home screen: the next touch resumes it.)
  // Not while hushed: a microphone may be open, and sound started then goes out as a phone call (hush below).
  if (!hushed) void ctx.resume();
};
// On touch screens only the finger lifting counts as the gesture (pointerup / touchend), not touching down.
for (const ev of ["pointerdown", "pointerup", "touchend", "keydown"]) window.addEventListener(ev, resume);

const sfxGain = ctx.createGain();
sfxGain.connect(ctx.destination);
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let muted = false;
/** No sound at all on this page (the UI catalog draws screens, it doesn't play them): silence(). */
let silent = false;
try {
  muted = localStorage.getItem("heroes.muted") === "1";
} catch {
  // Storage unavailable: default to sound on.
}

const music = new Audio();
music.loop = true;
// The music's volume through the context: iOS ignores an audio element's own volume (always full).
const musicGain = ctx.createGain();
musicGain.connect(ctx.destination);
try {
  ctx.createMediaElementSource(music).connect(musicGain);
} catch {
  // No routing (old browsers): the element's own volume then.
}

/** Volumes 0..1, remembered per browser. */
// Music a little under the effects, as the original's equal sliders with its louder effects.
const volumes = { music: 0.5, sfx: 0.8 };
try {
  const saved = JSON.parse(localStorage.getItem("heroes.volume") ?? "null");
  if (saved) Object.assign(volumes, saved);
} catch {
  // defaults
}
musicGain.gain.value = volumes.music;
sfxGain.gain.value = volumes.sfx;

export function getVolume(kind: "music" | "sfx"): number {
  return volumes[kind];
}

export function setVolume(kind: "music" | "sfx", v: number) {
  volumes[kind] = Math.max(0, Math.min(1, v));
  if (kind === "music") {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.value = volumes.music;
  }
  else sfxGain.gain.value = volumes.sfx;
  try {
    localStorage.setItem("heroes.volume", JSON.stringify(volumes));
  } catch {
    // not persisted
  }
}

function load(name: string): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p) {
    p = fetchRes(`${name}.wav`)
      .then((b) => {
        // The game's effects are IMA ADPCM, which decodeAudioData can't handle.
        const pcm = decodeWav(b);
        const buf = ctx.createBuffer(pcm.channels, pcm.data[0].length, pcm.sampleRate);
        pcm.data.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
        return buf;
      })
      .catch(() => null);
    buffers.set(name, p);
  }
  return p;
}

/** Fire-and-forget sound effect from the SND archives, e.g. "PIKEATTK"; resolves with its length in seconds (0: not played). */
/** One press, one click (ui/clicks.ts): the button sound already played for the press under way. */
let clickOfPress = { at: -1, held: false };
/** Starts a press: a "button" sound from now until releasePress is its one click. */
export function startPress(): void {
  clickOfPress = { at: -1, held: true };
}
/** The press is over (a moment after the finger lifts, so its tap's handlers count as the press too). */
export function releasePress(): void {
  const mine = clickOfPress;
  setTimeout(() => clickOfPress === mine && (clickOfPress = { at: -1, held: false }), 120);
}

export async function playSound(name: string): Promise<number> {
  // Quick combat plays a battle out in silence.
  // Hushed (a microphone open, or the page hidden): no effect, and the context stays paused (hush below).
  if (muted || silent || !name || !unlocked || quick || hushed) return 0;
  // A button clicks once a press, whether its own code, its window's or the stage's (ui/clicks.ts) asks first.
  if (name === "button" && clickOfPress.held) {
    if (clickOfPress.at >= 0) return 0;
    clickOfPress.at = performance.now();
  }
  // The click that unlocked audio may still be resuming the context; starting now queues the sound.
  if (ctx.state !== "running") void ctx.resume();
  const buf = await load(name);
  if (!buf) return 0;
  // In a feedback note's play log ("there was a sound when...").
  logPlay(`sound ${name}`);
  lastSounds.push({ name, at: performance.now(), s: buf.duration });
  if (lastSounds.length > 8) lastSounds.shift();
  if (import.meta.env.DEV) heard.push(name);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(sfxGain);
  src.start();
  return buf.duration;
}

/** A sound played over and over until the returned function stops it (a stack's steps while it walks, as VCMI's playSoundLooped). */
export function playSoundLooped(name: string): () => void {
  let src: AudioBufferSourceNode | null = null;
  let stopped = false;
  if (!muted && !silent && name && unlocked && !quick && !hushed) {
    if (ctx.state !== "running") void ctx.resume();
    void load(name).then((buf) => {
      if (!buf || stopped) return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(sfxGain);
      src.start();
    });
  }
  return () => {
    stopped = true;
    src?.stop();
    src = null;
  };
}

export function preloadSounds(names: string[]) {
  for (const n of names) void load(n);
}

/** The track switch waiting for the old track to fade out. */
let fading: ReturnType<typeof setTimeout> | null = null;
/** Seconds a track takes to fade out as another replaces it, and the next to fade in (the terrain music as a hero
 *  crosses a border, the town's music giving way to the land's): VCMI's 1000 ms each way (CMusicHandler queueNext,
 *  MusicEntry::play). Shorter, the town's music seemed cut off (2026-10-27). */
const FADE = 1;

/** Counts the music's changes, so a track waiting for a jingle doesn't start after another was asked for. */
let musicGen = 0;

/** Background track from the Mp3 folders; a playing track fades out first. */
export function playMusic(file: string, loop = true) {
  musicGen++;
  switchMusic(file, loop);
}

/**
 * A jingle with the music silent, then the track (a battle's intro, one of BATTLE00..07, then its
 * combat music, as VCMI's battleIntroSounds). Resolves when the jingle is over.
 */
export async function playMusicAfter(sound: string, file: string, loop = true) {
  const gen = ++musicGen;
  if (fading) clearTimeout(fading);
  fading = null;
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
  musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
  const secs = await playSound(sound);
  if (secs) await new Promise((r) => setTimeout(r, secs * 1000));
  if (gen !== musicGen) return;
  // (Faded out, so the track starts afresh rather than fading the old one again.)
  if (!music.src.endsWith(`/music/${encodeURIComponent(file)}`)) music.pause();
  switchMusic(file, loop);
}

function switchMusic(file: string, loop: boolean) {
  const url = `/music/${encodeURIComponent(file)}`;
  if (fading) clearTimeout(fading);
  fading = null;
  const start = (fadeIn = false) => {
    music.loop = loop;
    if (!music.src.endsWith(url)) music.src = url;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    if (fadeIn) {
      musicGain.gain.setValueAtTime(0, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(volumes.music, ctx.currentTime + FADE);
    } else musicGain.gain.setValueAtTime(volumes.music, ctx.currentTime);
    // Hushed: the new track starts when the hush lifts.
    if (hushed) hushed.music = true;
    else if (!muted && !silent) void music.play().catch(() => {
      // Autoplay blocked until the first interaction; retry then (a finger counts when it lifts).
      const retry = () => {
        if (hushed) hushed.music = true;
        else if (!muted) void music.play().then(() => ["pointerdown", "pointerup", "touchend"].forEach((ev) => window.removeEventListener(ev, retry))).catch(() => {});
      };
      // (The page's music, whichever page asked: pages.ts leaves it.)
      outsidePage(() => { for (const ev of ["pointerdown", "pointerup", "touchend"]) window.addEventListener(ev, retry); });
    });
  };
  // The same track (or nothing heard yet): no fade.
  if (music.src.endsWith(url) || music.paused || muted || ctx.state !== "running") {
    start();
    return;
  }
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
  musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
  fading = setTimeout(() => {
    fading = null;
    start(true);
  }, FADE * 1000);
}

/** This page makes no sound from now on, whatever its screens ask for (the UI catalog). */
export function silence() {
  silent = true;
  music.pause();
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("heroes.muted", m ? "1" : "0");
  } catch {
    // Not persisted; fine.
  }
  if (m) music.pause();
  else if (hushed) hushed.music = true;
  else void music.play().catch(() => {});
}

/**
 * Quiet while the feedback box listens: music paused and effects (and ambient loops) held, so the
 * microphone hears the player, not the game; afterwards everything carries on. The player's own
 * sound setting is left alone.
 */
let hushed: { music: boolean } | null = null;
const hushers = new Set<string>();
/** A microphone's hush still waiting to lift (see below), by who. */
const lifting = new Map<string, number>();
/**
 * How long the game stays quiet after a microphone lets go. On Android, Chrome puts the phone in "call" mode
 * while a microphone is open: sound started then goes out on the call stream (the volume slider with the little
 * phone, which can't go silent) and stays there until the page stops its sound again (2026-11-02, Pixel PWA,
 * after a voice note). The context resumes only once the phone is back in media mode, so the game's sound opens
 * on the media stream again.
 */
export const MIC_LET_GO_MS = 800;
export function hush(on: boolean, who = "mic") {
  clearTimeout(lifting.get(who));
  lifting.delete(who);
  if (on) hushers.add(who);
  else if ((who === "mic" || who === "voice") && hushers.has(who)) {
    const lift = () => (lifting.delete(who), hushers.delete(who), applyHush());
    return void lifting.set(who, window.setTimeout(lift, MIC_LET_GO_MS));
  } else hushers.delete(who);
  applyHush();
}
function applyHush() {
  if (hushers.size && !hushed) {
    hushed = { music: !music.paused };
    music.pause();
    void ctx.suspend();
  } else if (!hushers.size && hushed) {
    const was = hushed;
    hushed = null;
    if (unlocked) void ctx.resume();
    // The sliders' volumes again, whatever a ramp or the context's pause left (a slider moved meanwhile acts now).
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.value = volumes.music;
    sfxGain.gain.value = volumes.sfx;
    if (was.music && !muted && !silent) void music.play().catch(() => {});
  }
}

// Switching apps or taking a call: the page goes quiet (a phone call over Bluetooth drops the headset
// to its call mode, and the game's music would play through it, loud and tinny), unless the player
// keeps the music going in the background (Options).
const onVisibility = () => hush(document.hidden && !extra("keepMusic"), "hidden");
document.addEventListener("visibilitychange", onVisibility);
window.addEventListener("pagehide", () => hush(true, "hidden"));
window.addEventListener("pageshow", onVisibility);

/** Current music track (for debugging). */
/** The audio context's state ("suspended" until the first touch unlocks it). */
export const audioState = (): string => ctx.state;
export function nowPlaying(): { src: string; paused: boolean; volume: number; time: number } {
  return { src: music.src, paused: music.paused, volume: musicGain.gain.value, time: music.currentTime };
}
/** The last effects started, with when (a feedback note's sound state). */
const lastSounds: { name: string; at: number; s: number }[] = [];
/** Everything about the sound now, for a feedback note: muted, unlocked, the music, the volumes, the loops, the last effects. */
export function soundState(): Record<string, unknown> {
  const now = performance.now();
  return {
    muted,
    unlocked,
    silent: silent || undefined,
    quick: quick || undefined,
    context: ctx.state,
    music: { src: music.src.split("/").pop() || undefined, paused: music.paused, at: Math.round(music.currentTime), volume: getVolume("music"), gain: Math.round(musicGain.gain.value * 100) / 100, element: music.volume },
    sfx: getVolume("sfx"),
    // What the effects really go through, against the slider's volume above; who holds the sound quiet (the mic, the page
    // hidden) and the output's latency, which changes when a phone moves the sound to its call mode for the microphone
    // (2026-10-31 21:07: the sliders seemed not to act, the game loud, right after a voice note).
    sfxGain: Math.round(sfxGain.gain.value * 100) / 100,
    hushedBy: hushers.size ? [...hushers] : undefined,
    rate: ctx.sampleRate,
    latency: Math.round(((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0) * 1000),
    loops: Object.fromEntries([...ambient].map(([n, a]) => [n, Math.round(a.gain.gain.value * 100) / 100])),
    last: lastSounds.map((x) => `${x.name} ${((now - x.at) / 1000).toFixed(1)}s ago (${x.s.toFixed(1)}s long)`),
  };
}
/** The effects played so far (for checks in the browser). */
const heard: string[] = [];
if (import.meta.env.DEV) Object.assign(window, { __audio: { nowPlaying, heard, ambient: () => Object.fromEntries([...ambient].map(([n, a]) => [n, a.gain.gain.value])) } });

/** Looping ambient sounds (map objects near the view), each with its own volume. */
const ambient = new Map<string, { src: AudioBufferSourceNode | null; gain: GainNode; pending: boolean }>();

/** Plays these loops at these volumes (0..1); loops not listed fade out. */
export function setAmbient(levels: Map<string, number>) {
  if (!unlocked || silent) return;
  for (const [name, a] of ambient) {
    if (levels.has(name)) continue;
    a.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const src = a.src;
    setTimeout(() => src?.stop(), 1500);
    ambient.delete(name);
  }
  for (const [name, level] of levels) {
    // (A place not yet known, a map scrolled to no tile: no sound rather than an error.)
    if (!Number.isFinite(level)) continue;
    let a = ambient.get(name);
    if (!a) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(sfxGain);
      a = { src: null, gain, pending: true };
      ambient.set(name, a);
      const entry = a;
      void load(name).then((buf) => {
        if (!buf || ambient.get(name) !== entry) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(gain);
        src.start();
        entry.src = src;
        entry.pending = false;
      });
    }
    a.gain.gain.setTargetAtTime(muted ? 0 : level, ctx.currentTime, 0.3);
  }
}
