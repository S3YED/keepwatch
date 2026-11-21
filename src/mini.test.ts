import { expect, test } from "bun:test";
import { inViewNext, miniCorner, miniSize, miniWhen, shouldFloat, visibleShare, type MiniInput } from "./mini.ts";

test("the mini player is off unless the page names a corner", () => {
  expect(miniCorner(null)).toBeNull();
  expect(miniCorner("off")).toBeNull();
  expect(miniCorner("false")).toBeNull();
  expect(miniCorner("none")).toBeNull();
  expect(miniCorner("middle")).toBeNull();
  expect(miniCorner("bottom-right")).toBe("bottom-right");
  expect(miniCorner("bottom-left")).toBe("bottom-left");
  expect(miniCorner("top-right")).toBe("top-right");
  expect(miniCorner(" Top-Left ")).toBe("top-left");
  // A bare `mini` attribute: the usual corner.
  expect(miniCorner("")).toBe("bottom-right");
  expect(miniCorner("true")).toBe("bottom-right");
  expect(miniWhen(null)).toBe("playing");
  expect(miniWhen("always")).toBe("always");
  expect(miniWhen("whenever")).toBe("playing");
});

const base: MiniInput = { corner: "bottom-right", when: "playing", phase: "playing", inView: false, dismissed: false, fullscreen: false, floating: false };

test("it floats when a playing video scrolls out of view, and returns when it is back", () => {
  expect(shouldFloat(base)).toBe(true);
  expect(shouldFloat({ ...base, inView: true })).toBe(false);
  expect(shouldFloat({ ...base, floating: true, inView: true })).toBe(false);
  expect(shouldFloat({ ...base, corner: null })).toBe(false);
});

test("closing it keeps it closed; full screen never floats", () => {
  expect(shouldFloat({ ...base, dismissed: true })).toBe(false);
  expect(shouldFloat({ ...base, floating: true, dismissed: true })).toBe(false);
  expect(shouldFloat({ ...base, fullscreen: true })).toBe(false);
  expect(shouldFloat({ ...base, floating: true, fullscreen: true })).toBe(false);
});

test("only while playing: a poster, a muted preview or a paused video stays put", () => {
  for (const phase of ["idle", "resume", "loading", "muted", "paused", "ended", "error", "expired"]) {
    expect(shouldFloat({ ...base, phase })).toBe(false);
  }
  // Paused inside the mini player: it stays, or the viewer loses the play button.
  expect(shouldFloat({ ...base, floating: true, phase: "paused" })).toBe(true);
  // Anything that is not playing or paused sends it home.
  for (const phase of ["idle", "resume", "loading", "muted", "ended", "error", "expired"]) {
    expect(shouldFloat({ ...base, floating: true, phase })).toBe(false);
  }
});

test("when=always also follows the muted preview and a paused video", () => {
  const always = { ...base, when: "always" as const };
  for (const phase of ["muted", "playing", "paused"]) expect(shouldFloat({ ...always, phase })).toBe(true);
  for (const phase of ["idle", "resume", "loading", "ended", "error", "expired"]) {
    expect(shouldFloat({ ...always, phase })).toBe(false);
    expect(shouldFloat({ ...always, floating: true, phase })).toBe(false);
  }
  expect(shouldFloat({ ...always, inView: true })).toBe(false);
  expect(shouldFloat({ ...always, dismissed: true })).toBe(false);
});

test("how much of the player is on screen, also when it is taller than the screen", () => {
  const box = { width: 800, height: 450 };
  const screen = { width: 1280, height: 720 };
  expect(visibleShare({ width: 800, height: 450 }, box, screen)).toBe(1);
  expect(visibleShare({ width: 800, height: 225 }, box, screen)).toBe(0.5);
  expect(visibleShare({ width: 0, height: 0 }, box, screen)).toBe(0);
  // A vertical video on a short screen can never be fully visible: full screen of it counts as all.
  expect(visibleShare({ width: 360, height: 640 }, { width: 360, height: 900 }, { width: 360, height: 640 })).toBe(1);
  expect(visibleShare({ width: 360, height: 320 }, { width: 360, height: 900 }, { width: 360, height: 640 })).toBe(0.5);
  expect(visibleShare({ width: 10, height: 10 }, { width: 0, height: 0 }, screen)).toBe(0);
});

test("leaving and returning use different thresholds, so the edge does not flicker", () => {
  expect(inViewNext(true, 1)).toBe(true);
  expect(inViewNext(true, 0.3)).toBe(true);
  expect(inViewNext(true, 0.2)).toBe(false);
  expect(inViewNext(true, 0)).toBe(false);
  expect(inViewNext(false, 0.3)).toBe(false);
  expect(inViewNext(false, 0.5)).toBe(false);
  expect(inViewNext(false, 0.6)).toBe(true);
  expect(inViewNext(false, 1)).toBe(true);
});

test("the mini size: the asked width, smaller on phones, never taller than half the screen", () => {
  const wide = 16 / 9;
  expect(miniSize(null, { width: 1280, height: 800 }, wide)).toEqual({ width: 320, height: 180 });
  expect(miniSize(400, { width: 1280, height: 800 }, wide)).toEqual({ width: 400, height: 225 });
  // Out of range or unreadable: clamped or the default.
  expect(miniSize(20, { width: 1280, height: 800 }, wide).width).toBe(160);
  expect(miniSize(5000, { width: 1920, height: 1080 }, wide).width).toBe(640);
  expect(miniSize(Number.NaN, { width: 1280, height: 800 }, wide).width).toBe(320);
  // Phones: at most 60% of the screen width.
  expect(miniSize(null, { width: 375, height: 700 }, wide)).toEqual({ width: 225, height: 127 });
  // A vertical video: no taller than half the screen.
  expect(miniSize(null, { width: 1280, height: 800 }, 9 / 16)).toEqual({ width: 225, height: 400 });
  // A broken ratio falls back to 16:9.
  expect(miniSize(null, { width: 1280, height: 800 }, 0)).toEqual({ width: 320, height: 180 });
  expect(miniSize(null, { width: 1280, height: 800 }, Number.NaN)).toEqual({ width: 320, height: 180 });
});
