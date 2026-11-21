/**
 * Mini player decisions, pure and tested. When a playing video scrolls out of
 * view, the player floats in a corner; scrolling back, closing it, or going
 * full screen returns it. The element (ui/floating.ts) only carries these out.
 */

export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

const CORNERS: readonly Corner[] = ["bottom-right", "bottom-left", "top-right", "top-left"];

/** The `mini` attribute: a corner, or off. A bare `mini` is the usual corner. */
export function miniCorner(attr: string | null | undefined): Corner | null {
  if (attr == null) return null;
  const v = attr.trim().toLowerCase();
  if (v === "" || v === "true") return "bottom-right";
  return CORNERS.find((c) => c === v) ?? null;
}

export type MiniWhen = "playing" | "always";

export function miniWhen(attr: string | null | undefined): MiniWhen {
  return attr === "always" ? "always" : "playing";
}

export type MiniInput = {
  corner: Corner | null;
  when: MiniWhen;
  /** The player's phase (element.ts). */
  phase: string;
  /** The player's own place in the page is on screen. */
  inView: boolean;
  /** The viewer closed the mini player. */
  dismissed: boolean;
  /** Something on the page is full screen. */
  fullscreen: boolean;
  /** It floats now. */
  floating: boolean;
};

/**
 * Should the player float? With `when: "playing"` it starts floating only
 * while the video plays with sound, and stays while paused in the corner (or
 * the viewer would lose the play button). `when: "always"` also follows the
 * muted preview and a video paused in the page.
 */
export function shouldFloat(i: MiniInput): boolean {
  if (!i.corner || i.inView || i.dismissed || i.fullscreen) return false;
  if (i.phase === "playing") return true;
  if (i.phase === "paused") return i.floating || i.when === "always";
  if (i.phase === "muted") return i.when === "always";
  return false;
}

type Box = { width: number; height: number };

/**
 * How much of the player is on screen, 0 to 1, measured against what could
 * be on screen: a player taller than the window counts as fully visible when
 * it fills the window.
 */
export function visibleShare(intersection: Box, target: Box, root: Box): number {
  const most = Math.min(target.width * target.height, root.width * root.height);
  if (!(most > 0)) return 0;
  return Math.min(1, Math.max(0, (intersection.width * intersection.height) / most));
}

/** Out of view below this share. */
export const MINI_LEAVE_SHARE = 0.25;
/** Back in view from this share. The gap keeps the edge from flickering. */
export const MINI_RETURN_SHARE = 0.6;

export function inViewNext(prev: boolean, share: number): boolean {
  return prev ? share >= MINI_LEAVE_SHARE : share >= MINI_RETURN_SHARE;
}

export const MINI_WIDTH = 320;
const MINI_MIN = 160;
const MINI_MAX = 640;
const PHONE_MAX_WIDTH = 640;
const PHONE_SHARE = 0.6;
const EDGE = 32;

/**
 * The floating size in pixels: the asked width (default 320, 160 to 640), at
 * most 60% of a phone screen, and never taller than half the window, which
 * is what keeps a vertical video from covering the page.
 */
export function miniSize(requested: number | null | undefined, viewport: Box, ratio: number): Box {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9;
  const asked = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : MINI_WIDTH;
  let width = Math.min(MINI_MAX, Math.max(MINI_MIN, asked));
  width = Math.min(width, viewport.width <= PHONE_MAX_WIDTH ? viewport.width * PHONE_SHARE : viewport.width - EDGE);
  let height = width / r;
  if (viewport.height > 0 && height > viewport.height / 2) {
    height = viewport.height / 2;
    width = height * r;
  }
  return { width: Math.round(width), height: Math.round(height) };
}
