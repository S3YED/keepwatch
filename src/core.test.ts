import { expect, test } from "bun:test";
import {
  BEAT_MAX_BYTES,
  ctaVisible,
  displayProgress,
  mergeBeat,
  mmss,
  parseBeat,
  parseTime,
  parseVimeo,
  pickVariant,
  readUtm,
  resumeFrom,
  slug,
  summarise,
  vimeoEmbedUrl,
  type Variant,
  type ViewMeasures,
} from "./core.ts";

const A: Variant = { id: "cut-a", vimeoId: "1", weight: 1 };
const B: Variant = { id: "cut-b", vimeoId: "2", weight: 3 };

test("vimeo links in every common shape", () => {
  expect(parseVimeo("https://vimeo.com/1226915932")).toEqual({ vimeoId: "1226915932" });
  expect(parseVimeo("vimeo.com/1226915932/ab12cd34ef")).toEqual({ vimeoId: "1226915932", hash: "ab12cd34ef" });
  expect(parseVimeo("https://player.vimeo.com/video/1226915932?h=ab12cd&dnt=1")).toEqual({
    vimeoId: "1226915932",
    hash: "ab12cd",
  });
  expect(parseVimeo("https://vimeo.com/channels/staffpicks/123456")).toEqual({ vimeoId: "123456" });
  expect(parseVimeo("1226915932")).toEqual({ vimeoId: "1226915932" });
  expect(parseVimeo("https://youtube.com/watch?v=1234")).toBeNull();
  expect(parseVimeo("not a link")).toBeNull();
});

test("times as people write them", () => {
  expect(parseTime("6:11")).toBe(371);
  expect(parseTime("1:02:03")).toBe(3723);
  expect(parseTime("371")).toBe(371);
  expect(parseTime("371s")).toBe(371);
  expect(parseTime("soon")).toBeNull();
  expect(parseTime(null)).toBeNull();
  expect(mmss(371)).toBe("6:11");
  expect(mmss(3723)).toBe("1:02:03");
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

test("the embed hides Vimeo's chrome, keeps dnt and the unlisted hash", () => {
  const url = new URL(vimeoEmbedUrl({ vimeoId: "9", hash: "abc123" }, { muted: true, autoplay: true }));
  expect(url.pathname).toBe("/video/9");
  expect(url.searchParams.get("dnt")).toBe("1");
  expect(url.searchParams.get("controls")).toBe("0");
  expect(url.searchParams.get("muted")).toBe("1");
  expect(url.searchParams.get("h")).toBe("abc123");
  expect(new URL(vimeoEmbedUrl(A, { muted: false, autoplay: false })).searchParams.get("autoplay")).toBe("0");
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
