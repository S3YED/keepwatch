import { expect, test } from "bun:test";
import { barMode, barPosition, canSeek, clampSeek, seekFromPointer, seekKey } from "./bar.ts";
import { displayProgress } from "./core.ts";

test("bar modes: rapid unless the page asks for linear or none", () => {
  expect(barMode(null)).toBe("rapid");
  expect(barMode("rapid")).toBe("rapid");
  expect(barMode("linear")).toBe("linear");
  expect(barMode("none")).toBe("none");
  expect(barMode("fancy")).toBe("rapid");
});

test("the linear bar shows the real position; the rapid bar keeps its curve", () => {
  expect(barPosition(0, 200, "linear")).toBe(0);
  expect(barPosition(50, 200, "linear")).toBe(0.25);
  expect(barPosition(100, 200, "linear")).toBe(0.5);
  expect(barPosition(200, 200, "linear")).toBe(1);
  expect(barPosition(999, 200, "linear")).toBe(1);
  expect(barPosition(-5, 200, "linear")).toBe(0);
  expect(barPosition(50, 0, "linear")).toBe(0);
  expect(barPosition(50, Number.NaN, "linear")).toBe(0);
  // A curve never bends the linear bar.
  expect(barPosition(100, 200, "linear", 3)).toBe(0.5);
  // Rapid is the existing curve, unchanged.
  for (const t of [0, 1, 46.6, 233, 466, 999]) {
    expect(barPosition(t, 466, "rapid")).toBe(displayProgress(t, 466));
    expect(barPosition(t, 466, "rapid", 3)).toBe(displayProgress(t, 466, 3));
    expect(barPosition(t, 466, "none", 3)).toBe(displayProgress(t, 466, 3));
  }
  expect(barPosition(233, 466, "rapid")).toBeGreaterThan(0.75);
});

test("only the linear bar seeks, and a page can switch that off", () => {
  expect(canSeek("linear", null)).toBe(true);
  expect(canSeek("linear", "")).toBe(true);
  expect(canSeek("linear", "true")).toBe(true);
  expect(canSeek("linear", "false")).toBe(false);
  expect(canSeek("rapid", null)).toBe(false);
  expect(canSeek("rapid", "true")).toBe(false);
  expect(canSeek("none", null)).toBe(false);
});

test("a pointer on the bar is a time, clamped to the video", () => {
  // Bar from x=100, 400 wide, 200 second video.
  expect(seekFromPointer(100, 100, 400, 200)).toBe(0);
  expect(seekFromPointer(300, 100, 400, 200)).toBe(100);
  expect(seekFromPointer(500, 100, 400, 200)).toBe(200);
  expect(seekFromPointer(200, 100, 400, 200)).toBe(50);
  expect(seekFromPointer(20, 100, 400, 200)).toBe(0);
  expect(seekFromPointer(9999, 100, 400, 200)).toBe(200);
  // Right-to-left pages run the bar the other way.
  expect(seekFromPointer(200, 100, 400, 200, true)).toBe(150);
  // No width or no duration yet: nothing to seek to.
  expect(seekFromPointer(200, 100, 0, 200)).toBeNull();
  expect(seekFromPointer(200, 100, 400, 0)).toBeNull();
  expect(seekFromPointer(200, 100, 400, Number.NaN)).toBeNull();
  expect(seekFromPointer(Number.NaN, 100, 400, 200)).toBeNull();
});

test("slider keys: arrows step, page keys jump, Home and End go to the ends", () => {
  expect(seekKey("ArrowRight", 100, 600)).toBe(105);
  expect(seekKey("ArrowUp", 100, 600)).toBe(105);
  expect(seekKey("ArrowLeft", 100, 600)).toBe(95);
  expect(seekKey("ArrowDown", 100, 600)).toBe(95);
  expect(seekKey("ArrowLeft", 2, 600)).toBe(0);
  expect(seekKey("ArrowRight", 598, 600)).toBe(600);
  expect(seekKey("PageUp", 100, 600)).toBe(160);
  expect(seekKey("PageDown", 100, 600)).toBe(40);
  expect(seekKey("PageDown", 10, 600)).toBe(0);
  expect(seekKey("Home", 100, 600)).toBe(0);
  expect(seekKey("End", 100, 600)).toBe(600);
  expect(seekKey("Enter", 100, 600)).toBeNull();
  expect(seekKey("a", 100, 600)).toBeNull();
  expect(seekKey("ArrowRight", 100, 0)).toBeNull();
});

test("a seek target stays inside the video", () => {
  expect(clampSeek(-3, 200)).toBe(0);
  expect(clampSeek(50.5, 200)).toBe(50.5);
  expect(clampSeek(900, 200)).toBe(200);
  expect(clampSeek(Number.NaN, 200)).toBe(0);
  // Duration not known yet: only the lower bound holds.
  expect(clampSeek(50, 0)).toBe(50);
});
