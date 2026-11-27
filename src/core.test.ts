import { expect, test } from "bun:test";
import {
  BEAT_MAX_BYTES,
  ctaVisible,
  displayProgress,
  mergeBeat,
  clock,
  mmss,
  parseBeat,
  parseTime,
  pickVariant,
  reachEnd,
  reachJump,
  reachPlay,
  reachStart,
  readUtm,
  resumeFrom,
  slug,
  summarise,
  type Variant,
  type ViewMeasures,
} from "./core.ts";

const A: Variant = { id: "cut-a", source: { provider: "vimeo", id: "1" }, weight: 1 };
const B: Variant = { id: "cut-b", source: { provider: "youtube", id: "dQw4w9WgXcQ" }, weight: 3 };

test("times as people write them", () => {
  expect(parseTime("6:11")).toBe(371);
  expect(parseTime("1:02:03")).toBe(3723);
  expect(parseTime("371")).toBe(371);
  expect(parseTime("371s")).toBe(371);
  expect(parseTime("soon")).toBeNull();
  expect(parseTime(null)).toBeNull();
  expect(mmss(371)).toBe("6:11");
  expect(mmss(3723)).toBe("1:02:03");
  expect(clock(18)).toBe("00:18");
  expect(clock(371)).toBe("06:11");
  expect(clock(3723)).toBe("1:02:03");
});

test("the bar runs ahead early and still ends at the end", () => {
  expect(displayProgress(0, 466)).toBe(0);
  expect(displayProgress(466, 466)).toBe(1);
  expect(displayProgress(999, 466)).toBe(1);
  expect(displayProgress(46.6, 466)).toBeGreaterThan(0.2);
  expect(displayProgress(233, 466)).toBeGreaterThan(0.75);
  let last = 0;
  for (let t = 0; t <= 466; t++) {
    const p = displayProgress(t, 466);
    expect(p).toBeGreaterThanOrEqual(last);
    last = p;
  }
  expect(displayProgress(10, 0)).toBe(0);
  expect(displayProgress(10, Number.NaN)).toBe(0);
  expect(displayProgress(233, 466, 1)).toBe(0.5);
});

test("the CTA appears at the offer and stays, and never without a time", () => {
  expect(ctaVisible(370, 371)).toBe(false);
  expect(ctaVisible(371, 371)).toBe(true);
  expect(ctaVisible(9999, null)).toBe(false);
});

test("resume only when there is something to continue", () => {
  expect(resumeFrom(null, 466)).toBeNull();
  expect(resumeFrom(5, 466)).toBeNull();
  expect(resumeFrom(120.7, 466)).toBe(120);
  expect(resumeFrom(455, 466)).toBeNull();
  expect(resumeFrom(120, 0)).toBeNull();
});

test("variants: stored wins, new viewers split by weight", () => {
  expect(pickVariant([A, B], "cut-a", 0.99)?.id).toBe("cut-a");
  expect(pickVariant([{ ...A, weight: 0 }, B], "cut-a", 0.99)?.id).toBe("cut-a");
  expect(pickVariant([A, B], null, 0.24)?.id).toBe("cut-a");
  expect(pickVariant([A, B], null, 0.26)?.id).toBe("cut-b");
  expect(pickVariant([A, B], "gone", 1)?.id).toBe("cut-b");
  expect(pickVariant([], null, 0.5)).toBeNull();
});

test("slugs", () => {
  expect(slug("Clark VSL: 7:46 cut")).toBe("clark-vsl-7-46-cut");
  expect(slug("x".repeat(60))).toHaveLength(40);
});

const beat = {
  sid: "abcdefghijklmnop1234",
  site: "getclark.app",
  video: "clark-vsl",
  variant: "cut-a",
  placement: "main",
  locale: "en",
  durationSec: 466,
  furthestSec: 120.9,
  watchedSec: 118,
  unmuted: true,
  resumed: false,
  ctaShown: false,
  ctaClicked: false,
  completed: false,
  mobile: true,
  utmSource: " instagram ",
};

test("a valid beat parses, rounded down and trimmed", () => {
  const b = parseBeat(beat);
  expect(b?.furthestSec).toBe(120);
  expect(b?.utmSource).toBe("instagram");
  expect(b?.site).toBe("getclark.app");
});

test("a malformed beat is refused, not thrown", () => {
  for (const bad of [
    null,
    [],
    "x",
    { ...beat, sid: "short" },
    { ...beat, site: "Evil Site/" },
    { ...beat, video: "Has Spaces" },
    { ...beat, variant: "" },
    { ...beat, placement: "-x" },
    { ...beat, locale: "english" },
    { ...beat, furthestSec: -1 },
    { ...beat, durationSec: "466" },
    { ...beat, watchedSec: Number.POSITIVE_INFINITY },
  ]) {
    expect(parseBeat(bad)).toBeNull();
  }
  expect(parseBeat({ ...beat, unmuted: "yes" })?.unmuted).toBe(false);
  expect(parseBeat({ ...beat, furthestSec: 1e12 })?.furthestSec).toBe(4 * 60 * 60);
  expect(JSON.stringify({ ...beat, utmCampaign: "x".repeat(120) }).length).toBeLessThan(BEAT_MAX_BYTES);
});

test("viewer id and returning flag are optional, so older players still report", () => {
  const old = parseBeat(beat);
  expect(old).not.toBeNull();
  expect(old?.viewer).toBeUndefined();
  expect(old?.returning).toBeUndefined();
  const viewer = "v".repeat(32);
  const b = parseBeat({ ...beat, viewer, returning: true });
  expect(b?.viewer).toBe(viewer);
  expect(b?.returning).toBe(true);
  expect(parseBeat({ ...beat, viewer })?.returning).toBe(false);
  // A malformed id is dropped, never stored; the view itself still counts.
  for (const bad of ["short", "me@example.com", 42, "x".repeat(65), "V".repeat(32), "+31612345678-abcdefghijklmnopq"]) {
    const r = parseBeat({ ...beat, viewer: bad, returning: true });
    expect(r?.sid).toBe(beat.sid);
    expect(r?.viewer).toBeUndefined();
    expect(r?.returning).toBeUndefined();
  }
  expect(JSON.stringify({ ...beat, viewer, returning: true, utmCampaign: "x".repeat(120) }).length).toBeLessThan(BEAT_MAX_BYTES);
});

test("merging never undoes progress", () => {
  const b = parseBeat(beat)!;
  const first = mergeBeat(null, { ...b, ctaShown: true });
  const late = mergeBeat(first, { ...b, furthestSec: 30, watchedSec: 30, unmuted: false, ctaShown: false });
  expect(late.furthestSec).toBe(120);
  expect(late.unmuted).toBe(true);
  expect(late.ctaShown).toBe(true);
});

test("the summary counts plays, not page loads, and draws retention", () => {
  const row = (furthestSec: number, extra: Partial<ViewMeasures> = {}): ViewMeasures => ({
    durationSec: 466,
    furthestSec,
    watchedSec: furthestSec,
    unmuted: false,
    resumed: false,
    ctaShown: false,
    ctaClicked: false,
    completed: false,
    ...extra,
  });
  const s = summarise(
    [row(0), row(100, { unmuted: true }), row(400, { unmuted: true, ctaShown: true, ctaClicked: true }), row(466, { completed: true, ctaShown: true })],
    466,
    100,
  );
  expect([s.views, s.plays, s.unmuted, s.ctaShown, s.ctaClicked, s.completed]).toEqual([4, 3, 2, 2, 1, 1]);
  expect(s.retention).toEqual([1, 1, 2 / 3, 2 / 3, 2 / 3]);
  const empty = summarise([], 466);
  expect(empty.avgReached).toBe(0);
  expect(empty.retention.every((r) => r === 0)).toBe(true);
});

test("utm: only the five, trimmed", () => {
  expect(readUtm("?utm_source=ig&utm_medium=paid&gclid=x")).toEqual({
    utmSource: "ig",
    utmMedium: "paid",
    utmCampaign: undefined,
    utmContent: undefined,
  });
});

/* Reached means played to, with sound, from somewhere already reached. A jump is not that. */
const play = (r: ReturnType<typeof reachStart>, from: number, to: number, step = 0.25) => {
  let out = r;
  for (let t = from + step; t <= to + 1e-9; t += step) out = reachPlay(out, t);
  return out;
};

test("playing from the start moves the furthest point and counts the seconds", () => {
  const r = play(reachStart(0, 0), 0, 10);
  expect(r.reached).toBeCloseTo(10);
  expect(r.watched).toBeCloseTo(10);
});

test("seek forward, then play: the seconds are watched, the furthest point does not move", () => {
  // Watched to 0:10, jumped to 2:00, played five seconds.
  let r = play(reachStart(0, 0), 0, 10);
  r = reachJump(r, 120);
  expect(r.reached).toBeCloseTo(10);
  r = play(r, 120, 125);
  expect(Math.floor(r.reached)).toBe(10);
  expect(r.watched).toBeCloseTo(15);
  // So a CTA at 2:02 is not unlocked, and neither is the 25% mark of an 8-minute video.
  expect(ctaVisible(Math.floor(r.reached), 122)).toBe(false);
  // However long they stay out there.
  r = play(r, 125, 300);
  expect(Math.floor(r.reached)).toBe(10);
  // Back to where they really were: from there the furthest point moves again.
  r = play(reachJump(r, 8), 8, 30);
  expect(r.reached).toBeCloseTo(30);
});

test("a jump forward inside what was already reached is just a jump", () => {
  let r = play(reachStart(0, 0), 0, 60);
  r = reachJump(r, 20);
  r = reachJump(r, 55);
  r = play(r, 55, 70);
  expect(r.reached).toBeCloseTo(70);
});

test("seek back, then play: nothing is lost, and re-watching counts as listening", () => {
  let r = play(reachStart(0, 0), 0, 180);
  r = reachJump(r, 60);
  expect(r.reached).toBeCloseTo(180);
  r = play(r, 60, 65);
  expect(r.reached).toBeCloseTo(180);
  expect(r.watched).toBeCloseTo(185);
});

test("seek to the end: the video ends, but it was not completed", () => {
  // Dragged to the very end.
  let r = play(reachStart(0, 0), 0, 10);
  r = reachJump(r, 466);
  expect(reachEnd(r, 466).completed).toBe(false);
  expect(Math.floor(reachEnd(r, 466).reach.reached)).toBe(10);
  // Jumped to three seconds before the end and let it run out.
  r = play(reachJump(play(reachStart(0, 0), 0, 10), 463), 463, 465.9);
  expect(reachEnd(r, 466).completed).toBe(false);
  expect(Math.floor(reachEnd(r, 466).reach.reached)).toBe(10);
  // Watched to the end: completed, and the furthest point is the end, even if the last tick came early.
  r = play(reachStart(0, 0), 0, 465);
  const end = reachEnd(r, 466);
  expect(end.completed).toBe(true);
  expect(end.reach.reached).toBe(466);
  // A provider that never told the length still completes a video watched through.
  expect(reachEnd(r, 0).completed).toBe(true);
});

test("a chapter jump is a seek: the chapter's start is not reached until playback gets there", () => {
  let r = play(reachStart(0, 0), 0, 30);
  // The chapter list lands just inside the chapter (2:40 + a nudge).
  r = play(reachJump(r, 160.05), 160.05, 200);
  expect(Math.floor(r.reached)).toBe(30);
  expect(ctaVisible(Math.floor(r.reached), 160)).toBe(false);
  // A chapter that starts inside what was reached is fair game.
  r = play(reachJump(r, 20.05), 20.05, 40);
  expect(r.reached).toBeCloseTo(40, 1);
});

test("without a jump nothing changes: gaps, a muted stretch and a resume behave as before", () => {
  // A late tick (a throttled tab) still moves the furthest point; only its seconds are not counted.
  let r = play(reachStart(0, 0), 0, 10);
  r = reachPlay(r, 40);
  expect(r.reached).toBe(40);
  expect(r.watched).toBeCloseTo(10);
  // Resume at 2:00 of a video the viewer reached 2:30 in: the session starts at 2:00.
  r = play(reachStart(120, 150), 120, 125);
  expect(r.reached).toBeCloseTo(125);
  // Resume at a place they had only jumped to (reached 0:30): the session knows 0:30, no more.
  r = play(reachStart(120, 30), 120, 125);
  expect(Math.floor(r.reached)).toBe(30);
  // A new start in the same session never lowers what the session reached.
  expect(reachStart(0, 0, play(reachStart(0, 0), 0, 50)).reached).toBeCloseTo(50);
  // Going backwards in time without a jump (a provider's own loop) never lowers it either.
  r = reachPlay(play(reachStart(0, 0), 0, 50), 3);
  expect(r.reached).toBeCloseTo(50);
});
