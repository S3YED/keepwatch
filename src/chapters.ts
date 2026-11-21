/**
 * Chapters, pure and tested. A page gives them inline
 * (`chapters="0:00 Intro|1:20 Demo|2:40 Offer"`) or as the URL of a WebVTT
 * chapters file. Bad entries are skipped, the rest sorted; chapters that
 * start after the video ends are ignored once the length is known.
 */

import { barPosition, type BarMode } from "./bar.ts";
import { BAR_CURVE, parseTime } from "./core.ts";
import { fetchableUrl, type Cue } from "./vtt.ts";

export type Chapter = { start: number; title: string };

const TITLE_MAX = 80;
/** More than this is a transcript, not chapters. */
const CHAPTERS_MAX = 100;

function tidy(list: Chapter[]): Chapter[] {
  const out: Chapter[] = [];
  // A stable sort, so of two chapters at the same second the first one written wins.
  for (const c of [...list].sort((a, b) => a.start - b.start)) {
    const title = c.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
    if (!title || !Number.isFinite(c.start) || c.start < 0) continue;
    if (out.length && out[out.length - 1].start === c.start) continue;
    out.push({ start: c.start, title });
  }
  return out.slice(0, CHAPTERS_MAX);
}

/** `0:00 Intro|1:20 Demo`: entries split by "|" or a new line, each a time and a title. */
export function parseChapters(input: string): Chapter[] {
  const list: Chapter[] = [];
  for (const entry of input.split(/[|\n]/)) {
    const m = /^(\S+?):?\s+(?:[-–—:]\s*)?(.+)$/.exec(entry.trim());
    if (!m) continue;
    const start = parseTime(m[1]);
    if (start !== null) list.push({ start, title: m[2] });
  }
  return tidy(list);
}

/** A WebVTT chapters file: each cue is a chapter, its first line the title. */
export function chaptersFromCues(cues: readonly Cue[]): Chapter[] {
  return tidy(cues.map((c) => ({ start: c.start, title: c.text.split("\n")[0] })));
}

/**
 * Read the `chapters` setting: a list, or a link to fetch. A value with a
 * space or a "|" is a list; otherwise it has to look like a link to a file.
 */
export function chaptersInput(input: string | null | undefined): { inline: Chapter[] } | { url: string } | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/[|\s]/.test(s)) return { inline: parseChapters(s) };
  const url = fetchableUrl(s);
  if (!url) return null;
  return /^(https?:)?\/\/|^\.{0,2}\//i.test(url) || /\.vtt([?#]|$)/i.test(url) ? { url } : null;
}

/** The chapters inside the video. An unknown length keeps them all for now. */
export function fitChapters(chapters: readonly Chapter[], duration: number): Chapter[] {
  return duration > 0 ? chapters.filter((c) => c.start < duration) : [...chapters];
}

/** Index of the chapter playing at `t`; -1 before the first one. */
export function chapterAt(chapters: readonly Chapter[], t: number): number {
  if (!Number.isFinite(t)) return -1;
  let at = -1;
  for (let i = 0; i < chapters.length && chapters[i].start <= t; i++) at = i;
  return at;
}

/**
 * Where the chapter marks sit on the bar, 0 to 1. The same function as the
 * fill, so on a rapid bar a mark is where the rapid curve puts that time. No
 * mark at 0:00 (the bar's own start) and none on a hidden bar.
 */
export function chapterMarks(chapters: readonly Chapter[], duration: number, mode: BarMode, curve = BAR_CURVE): number[] {
  if (mode === "none" || !(duration > 0)) return [];
  return fitChapters(chapters, duration)
    .filter((c) => c.start > 0)
    .map((c) => barPosition(c.start, duration, mode, curve));
}
