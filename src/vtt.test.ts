import { expect, test } from "bun:test";
import { captionLines, cueText, cuesAt, parseCaptionTracks, parseVtt, parseVttTime, pickCaptionTrack } from "./vtt.ts";

test("WebVTT timestamps, with and without hours", () => {
  expect(parseVttTime("00:00:01.500")).toBe(1.5);
  expect(parseVttTime("01:02.250")).toBe(62.25);
  expect(parseVttTime("1:02:03.000")).toBe(3723);
  expect(parseVttTime("100:00:00.000")).toBe(360000);
  // SubRip's comma is common in hand-converted files.
  expect(parseVttTime("00:00:01,500")).toBe(1.5);
  expect(parseVttTime("1:02")).toBeNull();
  expect(parseVttTime("00:61:00.000")).toBeNull();
  expect(parseVttTime("00:00:61.000")).toBeNull();
  expect(parseVttTime("soon")).toBeNull();
  expect(parseVttTime("")).toBeNull();
});

test("cue text is plain text: tags go, entities decode once, markup never survives as markup", () => {
  expect(cueText("<v Roger>Hello <b>there</b></v>")).toBe("Hello there");
  expect(cueText("<c.yellow.bg_blue>Coloured</c> <i>and</i> <u>more</u>")).toBe("Coloured and more");
  expect(cueText("Kara<00:00:01.000>oke <00:00:02.000>time")).toBe("Karaoke time");
  expect(cueText("<ruby>漢<rt>kan</rt></ruby>")).toBe("漢kan");
  expect(cueText("Tom &amp; Jerry &lt;3 &gt; all&nbsp;else")).toBe("Tom & Jerry <3 > all else");
  expect(cueText("&#39;quoted&#39; &quot;twice&quot; &#x41;")).toBe("'quoted' \"twice\" A");
  // An escaped tag stays visible text; it is not decoded and then stripped, or kept as a tag.
  expect(cueText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  expect(cueText("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  expect(cueText("<img src=x onerror=alert(1)>boo")).toBe("boo");
  expect(cueText("a < b and b > a")).toBe("a < b and b > a");
  expect(cueText("line one\n  line two  ")).toBe("line one\nline two");
});

const SAMPLE = `﻿WEBVTT - Some title
Kind: captions
Language: en

NOTE
This is a comment
over several lines

STYLE
::cue { color: red }

REGION
id:fred

intro
00:00:01.000 --> 00:00:04.000 line:90% align:center
Welcome to the <b>video</b>.
Second line.

00:00:04.000 --> 00:00:06.500
- Hi!
- Hello &amp; welcome.

NOTE inline comment

01:10.000 --> 01:12.000
Late cue without hours
`;

test("a WebVTT file: header, NOTE, STYLE and REGION ignored, ids and cue settings dropped", () => {
  expect(parseVtt(SAMPLE)).toEqual([
    { start: 1, end: 4, text: "Welcome to the video.\nSecond line." },
    { start: 4, end: 6.5, text: "- Hi!\n- Hello & welcome." },
    { start: 70, end: 72, text: "Late cue without hours" },
  ]);
});

test("line endings and order do not matter; broken cues are skipped", () => {
  const crlf = "WEBVTT\r\n\r\n00:00:05.000 --> 00:00:06.000\r\nSecond\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nFirst\r\n";
  expect(parseVtt(crlf).map((c) => c.text)).toEqual(["First", "Second"]);
  expect(parseVtt("WEBVTT\r\r00:00:01.000 --> 00:00:02.000\rOld Mac\r").map((c) => c.text)).toEqual(["Old Mac"]);
  const broken = `WEBVTT

00:00:01.000 --> nonsense
Bad end

00:00:09.000 --> 00:00:03.000
Ends before it starts

00:00:03.000 --> 00:00:04.000

00:00:03.000 --> 00:00:04.000
<b></b>

just some text without a timing line

00:00:05.000 --> 00:00:06.000
Good
`;
  expect(parseVtt(broken)).toEqual([{ start: 5, end: 6, text: "Good" }]);
  expect(parseVtt("")).toEqual([]);
  expect(parseVtt("<html><body>404</body></html>")).toEqual([]);
  // A file without the header still parses: people strip it by accident.
  expect(parseVtt("00:00:01.000 --> 00:00:02.000\nNo header")).toEqual([{ start: 1, end: 2, text: "No header" }]);
});

test("the cues at a time: from the start, until just before the end, overlaps in order", () => {
  const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:04.000
One

00:00:03.000 --> 00:00:05.000
Two
on two lines

00:00:08.000 --> 00:00:09.000
Three
`);
  expect(cuesAt(cues, 0.99)).toEqual([]);
  expect(cuesAt(cues, 1).map((c) => c.text)).toEqual(["One"]);
  expect(cuesAt(cues, 3.5).map((c) => c.text)).toEqual(["One", "Two\non two lines"]);
  expect(cuesAt(cues, 4).map((c) => c.text)).toEqual(["Two\non two lines"]);
  expect(cuesAt(cues, 5)).toEqual([]);
  expect(cuesAt(cues, 8.5).map((c) => c.text)).toEqual(["Three"]);
  expect(cuesAt(cues, 100)).toEqual([]);
  expect(cuesAt(cues, Number.NaN)).toEqual([]);
  expect(cuesAt([], 3)).toEqual([]);
  expect(captionLines(cues, 3.5)).toEqual(["One", "Two", "on two lines"]);
  expect(captionLines(cues, 6)).toEqual([]);
});

test("captions setting: one file, or several as lang=url", () => {
  expect(parseCaptionTracks(null, null)).toEqual([]);
  expect(parseCaptionTracks("  ", "en")).toEqual([]);
  expect(parseCaptionTracks("/subs/talk.vtt", null)).toEqual([{ lang: "", url: "/subs/talk.vtt" }]);
  expect(parseCaptionTracks("/subs/talk.vtt", "NL")).toEqual([{ lang: "nl", url: "/subs/talk.vtt" }]);
  expect(parseCaptionTracks("https://cdn.example.com/a.vtt?token=x=y", "en")).toEqual([{ lang: "en", url: "https://cdn.example.com/a.vtt?token=x=y" }]);
  expect(parseCaptionTracks("en=/subs/en.vtt nl=/subs/nl.vtt\n pt-BR=https://cdn.example.com/pt.vtt?v=1", "nl")).toEqual([
    { lang: "en", url: "/subs/en.vtt" },
    { lang: "nl", url: "/subs/nl.vtt" },
    { lang: "pt-br", url: "https://cdn.example.com/pt.vtt?v=1" },
  ]);
  // The same language twice: the first wins. Links we would not fetch are dropped.
  expect(parseCaptionTracks("en=/a.vtt en=/b.vtt", null)).toEqual([{ lang: "en", url: "/a.vtt" }]);
  expect(parseCaptionTracks("javascript:alert(1)", null)).toEqual([]);
  expect(parseCaptionTracks("en=javascript:alert(1) nl=/nl.vtt", null)).toEqual([{ lang: "nl", url: "/nl.vtt" }]);
});

test("which captions a viewer starts with", () => {
  const one = parseCaptionTracks("/subs/talk.vtt", "en");
  const many = parseCaptionTracks("en=/en.vtt nl=/nl.vtt ru=/ru.vtt", null);
  // Nothing remembered: off, unless the page turns them on.
  expect(pickCaptionTrack(one, undefined, false, ["en"])).toBeNull();
  expect(pickCaptionTrack(one, undefined, true, ["nl"])?.lang).toBe("en");
  expect(pickCaptionTrack(many, undefined, true, ["nl-NL", "en"])?.lang).toBe("nl");
  expect(pickCaptionTrack(many, undefined, true, ["de", null, "ru"])?.lang).toBe("ru");
  expect(pickCaptionTrack(many, undefined, true, ["de"])?.lang).toBe("en");
  // The viewer's last choice wins over the page.
  expect(pickCaptionTrack(many, "off", true, ["nl"])).toBeNull();
  expect(pickCaptionTrack(many, "ru", false, ["nl"])?.lang).toBe("ru");
  // They had captions on in a language this video lacks: still on, best match.
  expect(pickCaptionTrack(many, "de", false, ["nl"])?.lang).toBe("nl");
  expect(pickCaptionTrack(one, "on", false, [])?.lang).toBe("en");
  expect(pickCaptionTrack([], "en", true, ["en"])).toBeNull();
});
