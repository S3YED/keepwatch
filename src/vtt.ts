/**
 * WebVTT, pure and tested: the parser behind captions and chapter files.
 *
 * Keepwatch draws captions itself, from the player's clock, because three of
 * its four providers play inside an iframe where a native text track cannot
 * reach. So the file is parsed here: timings and text, nothing else. Cue
 * settings, styles and regions are ignored; tags are stripped, and the text
 * that is left is only ever put on the page as text, never as HTML.
 */

export type Cue = { start: number; end: number; text: string };

/** "00:01:02.500" or "01:02.500" in seconds; null when unreadable. */
export function parseVttTime(input: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/.exec(input.trim());
  if (!m) return null;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (minutes > 59 || seconds > 59) return null;
  return Number(m[1] ?? 0) * 3600 + minutes * 60 + seconds + Number(m[4]) / 1000;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "‎", rlm: "‏" };
/** A cue tag (`<b>`, `</v>`, `<c.loud>`, `<v Name>`) or an inline timestamp (`<00:01.000>`). A lone "<" is text. */
const TAG = /<\/?[a-zA-Z][^>]*>|<\d[\d:.,]*>/g;
const ENTITY = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi;

function decodeEntity(whole: string, name: string): string {
  if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
  const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
}

/**
 * A cue's payload as plain text. Tags are removed first and entities decoded
 * once afterwards, so `&lt;b&gt;` ends up as the visible text "<b>" and is
 * never treated as a tag. The result is for `textContent` only.
 */
export function cueText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(TAG, "").replace(ENTITY, decodeEntity).trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Parse a WebVTT file. Malformed blocks are skipped, never thrown: a broken
 * captions file must not cost a viewer the video. Cues come back sorted.
 */
export function parseVtt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l, i) => i > 0 || l.trim() !== "");
    if (lines.length === 0) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    // An optional cue id sits on the line before the timing.
    const at = lines[0].includes("-->") ? 0 : lines.length > 1 && lines[1].includes("-->") ? 1 : -1;
    if (at < 0) continue;
    const [from, rest = ""] = lines[at].split("-->");
    const start = parseVttTime(from);
    // Cue settings (line:, align:, position:) follow the end time; they are dropped.
    const end = parseVttTime(rest.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null || end <= start) continue;
    const body = cueText(lines.slice(at + 1).join("\n"));
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cues showing at `t`: from their start until just before their end. */
export function cuesAt(cues: readonly Cue[], t: number): Cue[] {
  if (!Number.isFinite(t)) return [];
  return cues.filter((c) => c.start <= t && t < c.end);
}

/** The lines on screen at `t`, top to bottom. */
export function captionLines(cues: readonly Cue[], t: number): string[] {
  return cuesAt(cues, t).flatMap((c) => c.text.split("\n"));
}

/**
 * A link the player may fetch: http(s), protocol-relative or relative to the
 * page. Anything with another scheme (`javascript:`, `data:`, `file:`) is refused.
 */
export function fetchableUrl(input: string): string | null {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) return null;
  return url;
}

export type CaptionTrack = {
  /** Lower-case language tag ("en", "pt-br"); "" when the page did not say. */
  lang: string;
  url: string;
};

const LANG_PAIR = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)=(.+)$/;

/**
 * The `captions` setting. One file: `captions="/subs/talk.vtt"`, its language
 * from `captions-lang`. Several: `captions="en=/subs/en.vtt nl=/subs/nl.vtt"`,
 * separated by spaces or new lines (a URL holds neither).
 */
export function parseCaptionTracks(captions: string | null | undefined, lang: string | null | undefined): CaptionTrack[] {
  const fallback = (lang ?? "").trim().toLowerCase();
  const tracks: CaptionTrack[] = [];
  for (const token of (captions ?? "").split(/\s+/).filter(Boolean)) {
    const pair = LANG_PAIR.exec(token);
    const url = fetchableUrl(pair ? pair[2] : token);
    const code = pair ? pair[1].toLowerCase() : fallback;
    if (url && !tracks.some((t) => t.lang === code)) tracks.push({ lang: code, url });
  }
  return tracks;
}

const primary = (lang: string) => lang.toLowerCase().split("-")[0];

function bestTrack(tracks: readonly CaptionTrack[], langs: readonly (string | null | undefined)[]): CaptionTrack {
  for (const want of langs) {
    if (!want) continue;
    const w = want.toLowerCase();
    const hit = tracks.find((t) => t.lang === w) ?? tracks.find((t) => t.lang && primary(t.lang) === primary(w));
    if (hit) return hit;
  }
  return tracks[0];
}

/**
 * Which captions a viewer starts with. Their last choice wins: "off", or a
 * language. Without one, captions are off unless the page turns them on
 * (`captions-on`). `langs` is the order of preference when several fit.
 */
export function pickCaptionTrack(
  tracks: readonly CaptionTrack[],
  pref: string | null | undefined,
  defaultOn: boolean,
  langs: readonly (string | null | undefined)[],
): CaptionTrack | null {
  if (tracks.length === 0 || pref === "off") return null;
  if (pref) return tracks.find((t) => t.lang === pref.toLowerCase()) ?? bestTrack(tracks, langs);
  return defaultOn ? bestTrack(tracks, langs) : null;
}
