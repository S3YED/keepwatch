/**
 * Progress bar maths, pure and tested.
 *
 * Two bars: "rapid" runs ahead early (core.ts, `displayProgress`) and is a
 * display only; "linear" shows the real position and is a slider the viewer
 * can drag, tap and drive with the keyboard. Chapter marks use the same
 * function as the fill, so a mark and the fill always agree.
 */

import { BAR_CURVE, displayProgress } from "./core.ts";

export type BarMode = "rapid" | "linear" | "none";

/** The `bar` attribute. Anything unknown is the default, rapid. */
export function barMode(attr: string | null | undefined): BarMode {
  return attr === "linear" || attr === "none" ? attr : "rapid";
}

/** How full the bar is at `t`, 0 to 1. Linear ignores the curve. */
export function barPosition(t: number, duration: number, mode: BarMode, curve = BAR_CURVE): number {
  return displayProgress(t, duration, mode === "linear" ? 1 : curve);
}

/**
 * Only the linear bar seeks: on a rapid bar a position on screen is not the
 * position in the video, so a click there would land somewhere the viewer
 * did not point at. `seek="false"` keeps a linear bar a display.
 */
export function canSeek(mode: BarMode, seekAttr: string | null | undefined): boolean {
  return mode === "linear" && seekAttr !== "false";
}

/** A seek target inside the video. An unknown duration only holds the lower bound. */
export function clampSeek(to: number, duration: number): number {
  if (!Number.isFinite(to) || to <= 0) return 0;
  return duration > 0 ? Math.min(to, duration) : to;
}

/** The time under a pointer at `clientX` on a linear bar; null when there is nothing to seek in yet. */
export function seekFromPointer(clientX: number, left: number, width: number, duration: number, rtl = false): number | null {
  if (!(width > 0) || !(duration > 0) || !Number.isFinite(clientX) || !Number.isFinite(left)) return null;
  const x = Math.min(1, Math.max(0, (clientX - left) / width));
  return (rtl ? 1 - x : x) * duration;
}

export const SEEK_STEP_SEC = 5;
/** Page Up / Page Down move a tenth of the video. */
export const SEEK_PAGE_SHARE = 0.1;

/** Where a slider key takes the viewer; null for keys the slider does not own. */
export function seekKey(key: string, time: number, duration: number): number | null {
  if (!(duration > 0)) return null;
  const page = duration * SEEK_PAGE_SHARE;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampSeek(time + SEEK_STEP_SEC, duration);
    case "ArrowLeft":
    case "ArrowDown":
      return clampSeek(time - SEEK_STEP_SEC, duration);
    case "PageUp":
      return clampSeek(time + page, duration);
    case "PageDown":
      return clampSeek(time - page, duration);
    case "Home":
      return 0;
    case "End":
      return duration;
    default:
      return null;
  }
}
