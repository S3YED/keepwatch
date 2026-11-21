import { expect, test } from "bun:test";
import { chapterAt, chapterMarks, chaptersFromCues, chaptersInput, fitChapters, parseChapters } from "./chapters.ts";
import { displayProgress } from "./core.ts";
import { parseVtt } from "./vtt.ts";

test("inline chapters as people write them", () => {
  expect(parseChapters("0:00 Intro|1:20 Demo|2:40 Offer")).toEqual([
    { start: 0, title: "Intro" },
    { start: 80, title: "Demo" },
    { start: 160, title: "Offer" },
  ]);
  expect(parseChapters(" 0:00  Intro |  1:02:03   The long  part ")).toEqual([
    { start: 0, title: "Intro" },
    { start: 3723, title: "The long part" },
  ]);
  expect(parseChapters("0 Start\n90 Middle\n150s End")).toEqual([
    { start: 0, title: "Start" },
    { start: 90, title: "Middle" },
    { start: 150, title: "End" },
  ]);
  expect(parseChapters("1:20 - Demo|2:40: Offer")).toEqual([
    { start: 80, title: "Demo" },
    { start: 160, title: "Offer" },
  ]);
});

test("malformed chapters are skipped, the rest sorted, never thrown", () => {
  expect(parseChapters("2:40 Offer|soon Later|1:20|0:00 Intro||| 1:20 Demo|-5 Negative")).toEqual([
    { start: 0, title: "Intro" },
    { start: 80, title: "Demo" },
    { start: 160, title: "Offer" },
  ]);
  // Two chapters at the same second: the first one written wins.
  expect(parseChapters("0:10 First|0:10 Second")).toEqual([{ start: 10, title: "First" }]);
  expect(parseChapters("")).toEqual([]);
  expect(parseChapters("nonsense")).toEqual([]);
  expect(parseChapters("|||")).toEqual([]);
  expect(parseChapters(`0:00 ${"x".repeat(300)}`)[0].title).toHaveLength(80);
  // Titles are text. Nothing here is ever treated as markup.
  expect(parseChapters("0:05 <b>Bold</b> & co")).toEqual([{ start: 5, title: "<b>Bold</b> & co" }]);
});

test("the setting is either a list or the URL of a chapters file", () => {
  expect(chaptersInput(null)).toBeNull();
  expect(chaptersInput("  ")).toBeNull();
  expect(chaptersInput("0:00 Intro|1:20 Demo")).toEqual({ inline: parseChapters("0:00 Intro|1:20 Demo") });
  expect(chaptersInput("0:00 Intro")).toEqual({ inline: [{ start: 0, title: "Intro" }] });
  expect(chaptersInput("/video/chapters.vtt")).toEqual({ url: "/video/chapters.vtt" });
  expect(chaptersInput("https://cdn.example.com/c.vtt?v=2")).toEqual({ url: "https://cdn.example.com/c.vtt?v=2" });
  expect(chaptersInput("chapters.vtt")).toEqual({ url: "chapters.vtt" });
  // Not a list and not a link we would fetch: no chapters, no request.
  expect(chaptersInput("javascript:alert(1)")).toBeNull();
  expect(chaptersInput("data:text/vtt,WEBVTT")).toBeNull();
  expect(chaptersInput("nonsense")).toBeNull();
});

test("a WebVTT chapters file: each cue is a chapter, its first line the title", () => {
  const vtt = `WEBVTT

NOTE made by hand

2
00:01:20.000 --> 00:02:40.000
Demo
second line is ignored

1
00:00:00.000 --> 00:01:20.000
<v Narrator>Intro &amp; hello</v>

00:02:40.000 --> 00:05:00.000 align:start
Offer
`;
  expect(chaptersFromCues(parseVtt(vtt))).toEqual([
    { start: 0, title: "Intro & hello" },
    { start: 80, title: "Demo" },
    { start: 160, title: "Offer" },
  ]);
  expect(chaptersFromCues([])).toEqual([]);
});

test("chapters past the end are ignored once the length is known", () => {
  const list = parseChapters("0:00 Intro|1:20 Demo|2:40 Offer|9:00 Bonus");
  expect(fitChapters(list, 200).map((c) => c.title)).toEqual(["Intro", "Demo", "Offer"]);
  expect(fitChapters(list, 160).map((c) => c.title)).toEqual(["Intro", "Demo"]);
  // Length unknown: keep them all until it is.
  expect(fitChapters(list, 0)).toHaveLength(4);
  expect(fitChapters(list, Number.NaN)).toHaveLength(4);
  expect(fitChapters([], 200)).toEqual([]);
});

test("the current chapter at a time", () => {
  const list = parseChapters("0:10 Intro|1:20 Demo|2:40 Offer");
  expect(chapterAt(list, 0)).toBe(-1);
  expect(chapterAt(list, 9.9)).toBe(-1);
  expect(chapterAt(list, 10)).toBe(0);
  expect(chapterAt(list, 79.9)).toBe(0);
  expect(chapterAt(list, 80)).toBe(1);
  expect(chapterAt(list, 160)).toBe(2);
  expect(chapterAt(list, 99999)).toBe(2);
  expect(chapterAt([], 50)).toBe(-1);
  expect(chapterAt(list, Number.NaN)).toBe(-1);
});

test("marks sit where the bar puts that time, so a mark and the fill agree", () => {
  const list = parseChapters("0:00 Intro|1:40 Demo|3:20 Offer|9:00 Bonus");
  // Linear: the real position. No mark at the very start, none past the end.
  expect(chapterMarks(list, 400, "linear")).toEqual([0.25, 0.5]);
  // Rapid: the same curve as the fill, with the page's strength.
  expect(chapterMarks(list, 400, "rapid")).toEqual([displayProgress(100, 400), displayProgress(200, 400)]);
  expect(chapterMarks(list, 400, "rapid", 3)).toEqual([displayProgress(100, 400, 3), displayProgress(200, 400, 3)]);
  expect(chapterMarks(list, 400, "rapid")[0]).toBeGreaterThan(0.25);
  expect(chapterMarks(list, 400, "none")).toEqual([]);
  expect(chapterMarks(list, 0, "linear")).toEqual([]);
});
