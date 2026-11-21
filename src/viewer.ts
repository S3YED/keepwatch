import { currencyCode, money, orderId, slug, type Conversion } from "./core.ts";

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

const VIEWER_KEY = "keepwatch:viewer";
const LAST_KEY = "keepwatch:last";
const CONVERTED_KEY = "keepwatch:converted";
const ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Page views closer together than this are one visit. A later one makes the viewer returning. */
export const VISIT_GAP_MS = 30 * 60 * 1000;
/** How long a sent conversion is remembered, to drop a repeat (a reloaded thank-you page). */
export const CONVERTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
  const id = typeof saved?.id === "string" && ID.test(saved.id) ? saved.id : null;
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
  /** The sale amount in the currency's major unit: 497 or 497.5. */
  value: number | string;
  /** ISO 4217: "EUR", "usd". */
  currency: string;
  /** Your order id. Strongly advised: it is what makes a conversion count once. */
  id?: string | number;
  /** The collector. Default: the `collect` of the last player this browser watched. */
  collect?: string;
};

type Sent = { k: string; at: number };

/** Conversions sent from this page without storage, so a double call still counts once. */
const sentHere = new Set<string>();

/** Has this conversion been sent from this browser already? Records it when not. */
export function firstSend(store: KV | null, key: string, now: number): boolean {
  if (sentHere.has(key)) return false;
  const saved = read(store, CONVERTED_KEY);
  const list: Sent[] = Array.isArray(saved)
    ? (saved as Partial<Sent>[]).filter(
        (e): e is Sent => !!e && typeof e.k === "string" && typeof e.at === "number" && now - e.at < CONVERTED_TTL_MS,
      )
    : [];
  if (list.some((e) => e.k === key)) return false;
  sentHere.add(key);
  write(store, CONVERTED_KEY, [...list, { k: key, at: now }].slice(-CONVERTED_MAX));
  return true;
}

/** For tests: forget the in-page memory of sent conversions and of this page's viewer. */
export function resetPageState(): void {
  sentHere.clear();
  current = null;
}

export type ConvertContext = {
  store: KV | null;
  viewer: Viewer;
  site: string;
  path: string;
  now: number;
  cid: string;
};

/**
 * Build the conversion message, or say why not. Pure apart from the
 * dedupe record in `store`, so the rules are tested without a browser.
 * Without an order id, the same value and currency on the same page path
 * within CONVERTED_TTL_MS counts once (a reload of the thank-you page).
 */
export function prepareConversion(
  input: ConvertInput,
  ctx: ConvertContext,
): { ok: true; body: Conversion; endpoint: string } | { ok: false; reason: string } {
  const value = money(input?.value);
  const currency = currencyCode(input?.currency);
  if (value === null) return { ok: false, reason: "value must be a number from 0 to 10000000" };
  if (currency === null) return { ok: false, reason: "currency must be a three-letter ISO 4217 code" };
  let order: string | undefined;
  if (input.id !== undefined && input.id !== "") {
    const o = orderId(input.id);
    if (o === null) return { ok: false, reason: "id must be 1-64 letters, digits or . _ : # / -" };
    order = o;
  }
  const last = lastWatched(ctx.store);
  const endpoint = input.collect || last?.collect;
  if (!endpoint) return { ok: false, reason: "no collect endpoint: pass { collect } or watch a player with collect first" };
  const key = order ? `id:${order}` : `page:${ctx.path}|${value}|${currency}`;
  if (!firstSend(ctx.store, key, ctx.now)) return { ok: false, reason: "already sent" };
  const body: Conversion = {
    kind: "conversion",
    cid: ctx.cid,
    site: ctx.site,
    viewer: ctx.viewer.id,
    returning: ctx.viewer.returning,
    ...(last ? { video: last.video, variant: last.variant } : {}),
    value,
    currency,
    ...(order ? { orderId: order } : {}),
  };
  return { ok: true, body, endpoint };
}

/**
 * Report a sale from a thank-you page:
 *
 *   <script src="https://getclark.app/keepwatch.js"></script>
 *   <script>keepwatch.convert({ value: 497, currency: "EUR", id: "order-1042" })</script>
 *
 * Credits the sale to this browser's viewer id and the last video and
 * variant it watched. Returns true when a message was sent, false when it
 * was invalid, had nowhere to go, or was already sent (see console for why).
 * Also dispatches `keepwatch:conversion` on window, for pixels.
 */
export function convert(input: ConvertInput): boolean {
  if (typeof window === "undefined") return false;
  const result = prepareConversion(input, {
    store: browserStore(),
    viewer: viewer(),
    site: location.hostname.toLowerCase(),
    path: location.pathname,
    now: Date.now(),
    cid: randomId(),
  });
  if (!result.ok) {
    if (result.reason !== "already sent") console.warn(`[keepwatch] convert: ${result.reason}`);
    return false;
  }
  const json = JSON.stringify(result.body);
  window.dispatchEvent(new CustomEvent("keepwatch:conversion", { detail: result.body }));
  // A thank-you page is often left at once: a beacon survives that, a fetch may not.
  if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(result.endpoint, new Blob([json], { type: "text/plain" }))) {
    return true;
  }
  fetch(result.endpoint, {
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    headers: { "content-type": "text/plain" },
    body: json,
  }).catch(() => {
    // Best effort, like every report.
  });
  return true;
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
        convert({
          value: this.getAttribute("value") ?? "",
          currency: this.getAttribute("currency") ?? "",
          id: this.getAttribute("order-id") ?? undefined,
          collect: this.getAttribute("collect") ?? undefined,
        });
      }
    },
  );
}
