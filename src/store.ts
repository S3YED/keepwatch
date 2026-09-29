import { GATE_CSS } from "./styles.ts";

/**
 * Per-browser state, keyed by video: the sticky variant, where the viewer
 * is, and how far they ever got. localStorage is a convenience here; every
 * access is guarded, so a private window or blocked storage still plays the
 * video and only forgets on reload.
 */

export type Saved = { variant?: string; pos: number; furthest: number };

const key = (video: string) => `keepwatch:${video}`;

export function load(video: string): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(video)) ?? "null");
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      return {
        variant: typeof r.variant === "string" ? r.variant : undefined,
        pos: typeof r.pos === "number" ? r.pos : 0,
        furthest: typeof r.furthest === "number" ? r.furthest : 0,
      };
    }
  } catch {
    // Blocked or corrupt: start clean.
  }
  return { pos: 0, furthest: 0 };
}

export function save(video: string, patch: Partial<Saved>): Saved {
  const next = { ...load(video), ...patch };
  next.furthest = Math.max(next.furthest, Math.floor(next.pos));
  try {
    localStorage.setItem(key(video), JSON.stringify(next));
  } catch {
    // Storage blocked: the state holds for this page view.
  }
  return next;
}

/** Hide `[data-keepwatch-gate]` elements until a player unlocks. Idempotent. */
export function installGateStyle(): void {
  if (typeof document === "undefined" || document.getElementById("keepwatch-gates")) return;
  const style = document.createElement("style");
  style.id = "keepwatch-gates";
  style.textContent = GATE_CSS;
  document.head.appendChild(style);
}

/** Show every gate on the page, now and for gates rendered later. */
export function unlockGates(): void {
  document.documentElement.setAttribute("data-keepwatch-unlocked", "");
}

/* One audible player at a time: turning sound on claims the audio. */
const AUDIO_EVENT = "keepwatch:audio";

export function claimAudio(owner: object): void {
  window.dispatchEvent(new CustomEvent(AUDIO_EVENT, { detail: owner }));
}

export function onAudioClaimed(owner: object, pause: () => void): () => void {
  const handler = (e: Event) => {
    if ((e as CustomEvent<object>).detail !== owner) pause();
  };
  window.addEventListener(AUDIO_EVENT, handler);
  return () => window.removeEventListener(AUDIO_EVENT, handler);
}
