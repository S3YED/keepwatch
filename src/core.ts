/**
 * Keepwatch core: the rules, pure and tested. No DOM here, so the browser
 * element (element.ts) and the collector (server.ts) share one definition.
 *
 * What the player does, and why:
 * - Smart autoplay: starts muted with a "click to unmute" card and no progress
 *   bar, so the preview never looks like minutes already missed. The click
 *   restarts from 0:00 with sound, so nobody hears the pitch from the middle.
 * - A progress bar that runs fast early and slow late. A long video that
 *   looks a third done after the first minute loses fewer people.
 * - No seeking: the bar is a display, not a scrubber. Rewind 10s is the one
 *   way back, and it never moves `furthest`.
 * - Resume: a returning viewer continues where they left off.
 * - Timed CTA: the call to action appears when the offer starts, and stays
 *   for anyone who already reached that point.
 * - Variants: an A/B split over videos, sticky per browser.
 * - One analytics row per viewing session, updated as the viewer watches.
 */

import type { Source } from "./sources.ts";

export type Variant = {
  /** Stable id, stored with every view. Never reuse one for a different cut. */
  id: string;
  source: Source;
  /** Relative share of new viewers. 0 keeps a variant out of new assignments. */
  weight: number;
};

/** "6:11", "1:02:03", "371" or "371s" in seconds; null when unreadable. */
export function parseTime(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = input.trim().replace(/s$/, "");
  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return null;
  return s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** The player's time counter: "00:18", "06:11", "1:02:03". Elapsed only, never the total. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return s >= 3600 ? mmss(s) : mmss(s).padStart(5, "0");
}

/**
 * How full the bar looks at `t` seconds. `1 - (1 - x)^2.2`: about a fifth
 * at 10% in, a half at 27%, three quarters at 47%, and it only ever moves
 * forward. It still ends exactly at the end, so it never lies about the finish.
 */
export const BAR_CURVE = 2.2;

export function displayProgress(t: number, duration: number, curve = BAR_CURVE): number {
  if (!(duration > 0) || !(t > 0)) return 0;
  const x = Math.min(1, t / duration);
  return 1 - Math.pow(1 - x, curve);
}

/** Once past `ctaAtSec`, the CTA stays. No CTA time means no timed CTA. */
export function ctaVisible(furthestSec: number, ctaAtSec: number | null): boolean {
  return ctaAtSec !== null && furthestSec >= ctaAtSec;
}

/**
 * Offer "continue where you left off" only when there is something to
 * continue: more than 10 seconds in and more than 15 seconds before the end.
 */
export const RESUME_MIN_SEC = 10;
export const RESUME_TAIL_SEC = 15;

export function resumeFrom(savedSec: number | null | undefined, duration: number): number | null {
  if (typeof savedSec !== "number" || !Number.isFinite(savedSec)) return null;
  if (!(duration > 0)) return null;
  if (savedSec <= RESUME_MIN_SEC || savedSec >= duration - RESUME_TAIL_SEC) return null;
  return Math.floor(savedSec);
}

/**
 * Pick a variant for a new viewer. `roll` is in [0, 1). A stored id that
 * still exists wins, so a viewer never switches cuts between visits, even
 * after their variant's weight drops to 0.
 */
export function pickVariant(
  variants: readonly Variant[],
  storedId: string | null | undefined,
  roll: number,
): Variant | null {
  if (variants.length === 0) return null;
  const stored = storedId ? variants.find((v) => v.id === storedId) : undefined;
  if (stored) return stored;
  const live = variants.filter((v) => v.weight > 0);
  if (live.length === 0) return variants[0];
  const total = live.reduce((sum, v) => sum + v.weight, 0);
  let at = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const v of live) {
    if (at < v.weight) return v;
    at -= v.weight;
  }
  return live[live.length - 1];
}

/**
 * What the browser reports about one viewing session. Each report is the
 * whole state so far, so a lost report costs nothing and the collector
 * merges by maximum.
 */
export type Beat = {
  sid: string;
  /** The site's hostname, so one collector serves every site. */
  site: string;
  /** Which video: the `video` attribute, or the first variant's Vimeo id. */
  video: string;
  variant: string;
  /** Where on the site the player sits ("main", "hero", "popup"...). */
  placement: string;
  locale: string;
  durationSec: number;
  furthestSec: number;
  watchedSec: number;
  unmuted: boolean;
  resumed: boolean;
  ctaShown: boolean;
  ctaClicked: boolean;
  completed: boolean;
  mobile: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
};

/** The body is attacker-controlled. This is the size cap a collector enforces. */
export const BEAT_MAX_BYTES = 2048;

const SID = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOST = /^[a-z0-9.-]{1,120}$/;
const LOCALE = /^[a-z]{2}$/;
/** Longer than any VSL anyone would ship, so a nonsense number cannot skew a chart. */
const MAX_SEC = 4 * 60 * 60;

/** Lower-case, hyphenated, at most 40 chars: what `video`, `variant` and `placement` must look like. */
export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function sec(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.floor(value), MAX_SEC);
}

function utm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().slice(0, 120);
  return s || undefined;
}

/**
 * Validate a beat. Returns null for anything malformed rather than throwing:
 * the collector answers 400 and the player carries on, because a broken
 * beacon must never cost a viewer the video.
 */
export function parseBeat(raw: unknown): Beat | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string, re: RegExp) => (typeof r[k] === "string" && re.test(r[k] as string) ? (r[k] as string) : null);
  const sid = str("sid", SID);
  const site = str("site", HOST);
  const video = str("video", SLUG);
  const variant = str("variant", SLUG);
  const placement = str("placement", SLUG);
  const locale = str("locale", LOCALE);
  if (!sid || !site || !video || !variant || !placement || !locale) return null;
  const durationSec = sec(r.durationSec);
  const furthestSec = sec(r.furthestSec);
  const watchedSec = sec(r.watchedSec);
  if (durationSec === null || furthestSec === null || watchedSec === null) return null;
  const flag = (k: string) => r[k] === true;
  return {
    sid,
    site,
    video,
    variant,
    placement,
    locale,
    durationSec,
    furthestSec,
    watchedSec,
    unmuted: flag("unmuted"),
    resumed: flag("resumed"),
    ctaShown: flag("ctaShown"),
    ctaClicked: flag("ctaClicked"),
    completed: flag("completed"),
    mobile: flag("mobile"),
    utmSource: utm(r.utmSource),
    utmMedium: utm(r.utmMedium),
    utmCampaign: utm(r.utmCampaign),
    utmContent: utm(r.utmContent),
  };
}

/** A stored row's measures, as far as merging and charting are concerned. */
export type ViewMeasures = {
  durationSec: number;
  furthestSec: number;
  watchedSec: number;
  unmuted: boolean;
  resumed: boolean;
  ctaShown: boolean;
  ctaClicked: boolean;
  completed: boolean;
};

/**
 * Merge a beat into a stored row. Numbers only grow and flags only turn on,
 * so beats arriving out of order (a page-hide beacon overtaking a timer
 * beat) cannot undo progress.
 */
export function mergeBeat(row: ViewMeasures | null, beat: Beat): ViewMeasures {
  const b: ViewMeasures = {
    durationSec: beat.durationSec,
    furthestSec: beat.furthestSec,
    watchedSec: beat.watchedSec,
    unmuted: beat.unmuted,
    resumed: beat.resumed,
    ctaShown: beat.ctaShown,
    ctaClicked: beat.ctaClicked,
    completed: beat.completed,
  };
  if (!row) return b;
  return {
    durationSec: Math.max(row.durationSec, b.durationSec),
    furthestSec: Math.max(row.furthestSec, b.furthestSec),
    watchedSec: Math.max(row.watchedSec, b.watchedSec),
    unmuted: row.unmuted || b.unmuted,
    resumed: row.resumed || b.resumed,
    ctaShown: row.ctaShown || b.ctaShown,
    ctaClicked: row.ctaClicked || b.ctaClicked,
    completed: row.completed || b.completed,
  };
}

export type Stats = {
  views: number;
  /** Views where the viewer listened for at least one second. */
  plays: number;
  unmuted: number;
  ctaShown: number;
  ctaClicked: number;
  completed: number;
  /** Mean share of the video reached, over plays, 0 to 1. */
  avgReached: number;
  /** `retention[i]` = share of plays that reached `i * step` seconds. */
  retention: number[];
  step: number;
};

/**
 * The numbers for a dashboard. Retention is measured on `furthestSec`, the
 * point each viewer reached with sound on, which is what a drop-off chart shows.
 */
export function summarise(rows: readonly ViewMeasures[], durationSec: number, step = 10): Stats {
  const played = rows.filter((r) => r.furthestSec >= 1);
  const buckets = durationSec > 0 ? Math.floor(durationSec / step) + 1 : 0;
  const retention: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const at = i * step;
    const reached = played.filter((r) => r.furthestSec >= at).length;
    retention.push(played.length ? reached / played.length : 0);
  }
  const avgReached =
    played.length && durationSec > 0
      ? played.reduce((sum, r) => sum + Math.min(1, r.furthestSec / durationSec), 0) / played.length
      : 0;
  return {
    views: rows.length,
    plays: played.length,
    unmuted: rows.filter((r) => r.unmuted).length,
    ctaShown: rows.filter((r) => r.ctaShown).length,
    ctaClicked: rows.filter((r) => r.ctaClicked).length,
    completed: rows.filter((r) => r.completed).length,
    avgReached,
    retention,
    step,
  };
}

/** Read the five `utm_*` parameters. Only these: they end up in a stored row. */
export function readUtm(search: string): Pick<Beat, "utmSource" | "utmMedium" | "utmCampaign" | "utmContent"> {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const get = (k: string) => utm(p.get(k));
  return {
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
  };
}
