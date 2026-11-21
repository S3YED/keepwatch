import { RANDOM_ID, currencyCode, money, orderId, slug, type Conversion } from "./core.ts";

/**
 * Who is watching, without knowing who: an anonymous viewer id, a
 * "returning" flag, the last video this browser watched, and the
 * conversion call a thank-you page makes.
 *
 * The viewer id is random and first-party: it lives in this site's
 * localStorage and nowhere else. No cookie, no IP, no fingerprint, no
 * personal data. When storage is blocked (a private window, a strict
 * browser) the id lives for one page view, the viewer counts as new, and
 * everything else still works.
 */

/** The two Storage methods used here, so tests can pass a fake or a throwing one. */
export type KV = Pick<Storage, "getItem" | "setItem">;

/**
 * Tracking state lives under "keepwatch/", playback under "keepwatch:<video>"
 * (store.ts). Every playback key starts "keepwatch:", so no video id, not
 * even one named "viewer", can produce a tracking key, and the playback keys
 * keep their 0.3.0 names: saved resume positions survive the upgrade.
 */
export const TRACKING_PREFIX = "keepwatch/";
export const VIEWER_KEY = `${TRACKING_PREFIX}viewer`;
export const LAST_KEY = `${TRACKING_PREFIX}last`;
export const CONVERTED_KEY = `${TRACKING_PREFIX}converted`;
export const CIDS_KEY = `${TRACKING_PREFIX}cids`;

/** Page views closer together than this are one visit. A later one makes the viewer returning. */
export const VISIT_GAP_MS = 30 * 60 * 1000;
/** How long a sent order is remembered, to drop a repeat (a reloaded thank-you page). */
export const CONVERTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Without an order id, the same sale on the same page counts once within this
 * window only (a reload), so a second purchase the next day still counts.
 * The tradeoff: a thank-you page reloaded after the window counts again.
 * Pass an order id to dedupe for good.
 */
export const UNNAMED_TTL_MS = 30 * 60 * 1000;
const CONVERTED_MAX = 50;

/** localStorage, or null when the browser refuses it. Reading the property can itself throw. */
export function browserStore(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 32 random characters from [0-9a-z], the same shape as a session id. */
export function randomId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

function read(store: KV | null, key: string): Record<string, unknown> | unknown[] | null {
  if (!store) return null;
  try {
    const raw: unknown = JSON.parse(store.getItem(key) ?? "null");
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function write(store: KV | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export type Viewer = { id: string; returning: boolean };

/**
 * Read (or create) the viewer, counting this page view. A viewer is
 * returning when an earlier visit exists: a page view more than
 * VISIT_GAP_MS before this one. Call once per page view; `viewer()` does.
 */
export function visit(store: KV | null, now: number, newId: () => string = randomId): Viewer {
  const saved = read(store, VIEWER_KEY) as Record<string, unknown> | null;
  const id = typeof saved?.id === "string" && RANDOM_ID.test(saved.id) ? saved.id : null;
  if (!id) {
    const fresh = newId();
    write(store, VIEWER_KEY, { id: fresh, visits: 1, last: now });
    return { id: fresh, returning: false };
  }
  const visits = typeof saved?.visits === "number" && saved.visits >= 1 ? Math.floor(saved.visits) : 1;
  const last = typeof saved?.last === "number" ? saved.last : 0;
  const next = now - last > VISIT_GAP_MS ? visits + 1 : visits;
  write(store, VIEWER_KEY, { id, visits: next, last: now });
  return { id, returning: next > 1 };
}

let current: Viewer | null = null;

/** This page view's viewer, the same for every player and every call on the page. */
export function viewer(): Viewer {
  current ??= visit(browserStore(), Date.now());
  return current;
}

/** The last video this browser started, for crediting a later conversion. */
export type LastWatched = { video: string; variant: string; collect?: string; at: number };

export function rememberWatched(store: KV | null, w: LastWatched): void {
  write(store, LAST_KEY, w);
}

export function lastWatched(store: KV | null): LastWatched | null {
  const r = read(store, LAST_KEY) as Record<string, unknown> | null;
  if (!r || typeof r.video !== "string" || typeof r.variant !== "string") return null;
  const video = slug(r.video);
  const variant = slug(r.variant);
  if (!video || !variant || video !== r.video || variant !== r.variant) return null;
  return {
    video,
    variant,
    collect: typeof r.collect === "string" ? r.collect : undefined,
    at: typeof r.at === "number" ? r.at : 0,
  };
}

/** What a thank-you page passes to `keepwatch.convert()`. */
export type ConvertInput = {
  /** The sale amount in the currency's major unit: 497 or 497.5. At most 100000. */
  value: number | string;
  /** ISO 4217: "EUR", "usd". */
  currency: string;
  /**
   * Your order id. Hashed in the browser before it is sent, so it never
   * leaves the page; strongly advised, as it is what makes an order count once.
   */
  id?: string | number;
  /** The collector. Default: the `collect` of the last player this browser watched. */
  collect?: string;
};

type Sent = { k: string; at: number };

/** Conversions sent from this page, so a double call counts once even without storage. */
const sentHere = new Set<string>();
/** Conversions being sent right now, so two overlapping calls send once. Released when the send ends. */
const inFlight = new Set<string>();
/** Send ids per dedupe key for this page, for when storage is blocked. */
const cidsHere = new Map<string, { cid: string; at: number }>();

const ttlOf = (key: string) => (key.startsWith("order:") ? CONVERTED_TTL_MS : UNNAMED_TTL_MS);

function sentList(store: KV | null, now: number): Sent[] {
  const saved = read(store, CONVERTED_KEY);
  return Array.isArray(saved)
    ? (saved as Partial<Sent>[]).filter(
        (e): e is Sent => !!e && typeof e.k === "string" && typeof e.at === "number" && now - e.at < ttlOf(e.k),
      )
    : [];
}

/** Was this conversion already delivered from this browser, within its window? */
export function alreadySent(store: KV | null, key: string, now: number): boolean {
  return sentHere.has(key) || sentList(store, now).some((e) => e.k === key);
}

/** Remember a delivered conversion. Only called once the transport accepted it. */
export function recordSent(store: KV | null, key: string, now: number): void {
  sentHere.add(key);
  write(store, CONVERTED_KEY, [...sentList(store, now).filter((e) => e.k !== key), { k: key, at: now }].slice(-CONVERTED_MAX));
}

type CidEntry = { k: string; cid: string; at: number };

/**
 * The send id for a dedupe key: the same one for every attempt inside the
 * key's window (a retry after a failed send, another tab), so a collector
 * that did get an earlier attempt stores the sale once. A new one after
 * the window, when the sale may be a new purchase.
 */
export function cidFor(store: KV | null, key: string, now: number, fresh: string): string {
  const live = (e: { at: number }) => now - e.at < ttlOf(key);
  const saved = read(store, CIDS_KEY);
  const list = Array.isArray(saved)
    ? (saved as Partial<CidEntry>[]).filter(
        (e): e is CidEntry =>
          !!e && typeof e.k === "string" && typeof e.cid === "string" && RANDOM_ID.test(e.cid) && typeof e.at === "number" && now - e.at < ttlOf(e.k),
      )
    : [];
  const here = cidsHere.get(key);
  const found = list.find((e) => e.k === key) ?? (here && live(here) ? { k: key, ...here } : undefined);
  if (found) return found.cid;
  cidsHere.set(key, { cid: fresh, at: now });
  write(store, CIDS_KEY, [...list, { k: key, cid: fresh, at: now }].slice(-CONVERTED_MAX));
  return fresh;
}

/** For tests: forget the in-page memory of sent conversions and of this page's viewer. */
export function resetPageState(): void {
  sentHere.clear();
  inFlight.clear();
  cidsHere.clear();
  current = null;
}

/** SHA-256 hex, or null where SubtleCrypto is missing (plain http, old browsers) or fails. */
export async function sha256Hex(text: string, subtle: SubtleCrypto | null): Promise<string | null> {
  if (!subtle) return null;
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Hand a message to the network. True when the browser accepted it for delivery. */
export type Transport = (endpoint: string, json: string) => Promise<boolean>;

/**
 * sendBeacon first: a thank-you page is often left at once, and a beacon
 * survives that. Otherwise fetch with no-cors, whose response is opaque,
 * so "accepted" means the request went out without a network error.
 */
export const browserTransport: Transport = async (endpoint, json) => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(endpoint, new Blob([json], { type: "text/plain" }))) return true;
    }
    await fetch(endpoint, { method: "POST", mode: "no-cors", keepalive: true, headers: { "content-type": "text/plain" }, body: json });
    return true;
  } catch {
    return false;
  }
};

export type ConvertContext = {
  store: KV | null;
  viewer: Viewer;
  site: string;
  path: string;
  now: number;
  /** A fresh send id, used unless this key already has one inside its window (`cidFor`). */
  cid: string;
  /** Injected for tests; defaults to the browser's SubtleCrypto. */
  subtle?: SubtleCrypto | null;
};

export type Prepared = { ok: true; body: Conversion; endpoint: string; key: string } | { ok: false; reason: string };

/**
 * Build the conversion message, or say why not. Records nothing: the caller
 * records the dedupe key with `recordSent` only after the send succeeded.
 * The order id is hashed (`keepwatch:<site>:<id>`); without SubtleCrypto it
 * is left out, and the sale dedupes like one without an order id.
 */
export async function prepareConversion(input: ConvertInput, ctx: ConvertContext): Promise<Prepared> {
  const value = money(input?.value);
  const currency = currencyCode(input?.currency);
  if (value === null) return { ok: false, reason: "value must be a number from 0 to 100000" };
  if (currency === null) return { ok: false, reason: "currency must be a three-letter ISO 4217 code" };
  let orderHash: string | null = null;
  if (input.id !== undefined && input.id !== "") {
    const o = orderId(input.id);
    if (o === null) return { ok: false, reason: "id must be 1-64 letters, digits or . _ : # / -" };
    const subtle = ctx.subtle === undefined ? (globalThis.crypto?.subtle ?? null) : ctx.subtle;
    orderHash = await sha256Hex(`keepwatch:${ctx.site}:${o}`, subtle);
  }
  const last = lastWatched(ctx.store);
  const endpoint = input.collect || last?.collect;
  if (!endpoint) return { ok: false, reason: "no collect endpoint: pass { collect } or watch a player with collect first" };
  const key = orderHash ? `order:${orderHash}` : `page:${ctx.path}|${value}|${currency}`;
  if (alreadySent(ctx.store, key, ctx.now)) return { ok: false, reason: "already sent" };
  const body: Conversion = {
    kind: "conversion",
    cid: cidFor(ctx.store, key, ctx.now, ctx.cid),
    site: ctx.site,
    viewer: ctx.viewer.id,
    returning: ctx.viewer.returning,
    ...(last ? { video: last.video, variant: last.variant } : {}),
    value,
    currency,
    ...(orderHash ? { orderHash } : {}),
  };
  return { ok: true, body, endpoint, key };
}

/** Prepare, send, and record only what was sent. The testable core of `convert`. */
export async function sendConversion(input: ConvertInput, ctx: ConvertContext, transport: Transport): Promise<Prepared & { sent?: boolean }> {
  const result = await prepareConversion(input, ctx);
  if (!result.ok) return result;
  // Synchronous from here to the transport call, so an overlapping call
  // (which also awaited the hash) sees this one in flight or already sent.
  if (inFlight.has(result.key) || alreadySent(ctx.store, result.key, ctx.now)) return { ok: false, reason: "already sent" };
  inFlight.add(result.key);
  try {
    const sent = await transport(result.endpoint, JSON.stringify(result.body));
    if (sent) recordSent(ctx.store, result.key, ctx.now);
    return { ...result, sent };
  } finally {
    inFlight.delete(result.key);
  }
}

/**
 * Report a sale from a thank-you page:
 *
 *   <script src="https://getclark.app/keepwatch.js"></script>
 *   <script>keepwatch.convert({ value: 497, currency: "EUR", id: "order-1042" })</script>
 *
 * Credits the sale to this browser's viewer id and the last video and
 * variant it watched. Resolves true when the message was handed to the
 * network, false when it was invalid, had nowhere to go, was already sent,
 * or the send failed (a failed send is not remembered, so a reload retries).
 * Also dispatches `keepwatch:conversion` on window, for pixels.
 *
 * The collector cannot verify it: it is a browser report, like any pixel.
 */
export async function convert(input: ConvertInput): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const result = await sendConversion(
    input,
    {
      store: browserStore(),
      viewer: viewer(),
      site: location.hostname.toLowerCase(),
      path: location.pathname,
      now: Date.now(),
      cid: randomId(),
    },
    browserTransport,
  );
  if (!result.ok) {
    if (result.reason !== "already sent") console.warn(`[keepwatch] convert: ${result.reason}`);
    return false;
  }
  if (result.sent) window.dispatchEvent(new CustomEvent("keepwatch:conversion", { detail: result.body }));
  return result.sent === true;
}

/**
 * The same as `keepwatch.convert()`, as markup, for page builders that
 * cannot run a script:
 *
 *   <keep-watch-convert value="497" currency="EUR" order-id="1042"></keep-watch-convert>
 *
 * Sends once when it is attached (and again only for a different order).
 * Optional `collect` overrides the endpoint. It renders nothing.
 */
export function defineConvert(tag = "keep-watch-convert"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        this.hidden = true;
        void convert({
          value: this.getAttribute("value") ?? "",
          currency: this.getAttribute("currency") ?? "",
          id: this.getAttribute("order-id") ?? undefined,
          collect: this.getAttribute("collect") ?? undefined,
        });
      }
    },
  );
}
