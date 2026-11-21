import { beforeEach, expect, test } from "bun:test";
import { CONVERSION_MAX_BYTES, conversionKey, parseConversion } from "./core.ts";
import {
  CONVERTED_TTL_MS,
  VISIT_GAP_MS,
  firstSend,
  lastWatched,
  prepareConversion,
  rememberWatched,
  resetPageState,
  visit,
  type ConvertContext,
  type KV,
} from "./viewer.ts";

function memory(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** A browser that refuses storage: every call throws, as Safari's private mode once did. */
const blocked: KV = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

const ids = (...list: string[]) => () => list.shift() ?? "z".repeat(32);
const A = "a".repeat(32);
const B = "b".repeat(32);

beforeEach(() => resetPageState());

test("a new browser gets a random viewer id and is not returning", () => {
  const store = memory();
  expect(visit(store, 1_000, ids(A))).toEqual({ id: A, returning: false });
  expect(JSON.parse(store.data.get("keepwatch:viewer")!)).toEqual({ id: A, visits: 1, last: 1_000 });
});

test("the id persists; a page view within the visit gap is the same visit", () => {
  const store = memory();
  visit(store, 0, ids(A));
  expect(visit(store, VISIT_GAP_MS, ids(B))).toEqual({ id: A, returning: false });
});

test("a page view after the gap is a returning viewer, and stays returning", () => {
  const store = memory();
  visit(store, 0, ids(A));
  const later = VISIT_GAP_MS + 1;
  expect(visit(store, later, ids(B))).toEqual({ id: A, returning: true });
  expect(visit(store, later + 1, ids(B))).toEqual({ id: A, returning: true });
});

test("a corrupt or foreign stored id is replaced, not trusted", () => {
  const store = memory();
  store.data.set("keepwatch:viewer", JSON.stringify({ id: "me@example.com", visits: 9, last: 0 }));
  expect(visit(store, 10 ** 9, ids(B))).toEqual({ id: B, returning: false });
  store.data.set("keepwatch:viewer", "{not json");
  expect(visit(store, 10 ** 9, ids(A)).id).toBe(A);
});

test("missing storage: a per-page id, never returning, never throws", () => {
  expect(visit(blocked, 0, ids(A))).toEqual({ id: A, returning: false });
  expect(visit(null, 0, ids(B))).toEqual({ id: B, returning: false });
});

test("last watched round-trips and refuses tampered values", () => {
  const store = memory();
  expect(lastWatched(store)).toBeNull();
  rememberWatched(store, { video: "clark-vsl", variant: "cut-a", collect: "https://getclark.app/api/vsl", at: 5 });
  expect(lastWatched(store)).toEqual({ video: "clark-vsl", variant: "cut-a", collect: "https://getclark.app/api/vsl", at: 5 });
  store.data.set("keepwatch:last", JSON.stringify({ video: "<script>", variant: "a" }));
  expect(lastWatched(store)).toBeNull();
  expect(lastWatched(blocked)).toBeNull();
  rememberWatched(blocked, { video: "v", variant: "a", at: 0 }); // does not throw
});

function ctx(store: KV | null, over: Partial<ConvertContext> = {}): ConvertContext {
  return { store, viewer: { id: A, returning: true }, site: "getclark.app", path: "/thanks", now: 1_000, cid: B, ...over };
}

test("convert credits the viewer and the last watched video and variant", () => {
  const store = memory();
  rememberWatched(store, { video: "clark-vsl", variant: "cut-b", collect: "https://getclark.app/api/vsl", at: 0 });
  const r = prepareConversion({ value: "497.5", currency: "eur", id: "order-1042" }, ctx(store));
  expect(r).toEqual({
    ok: true,
    endpoint: "https://getclark.app/api/vsl",
    body: {
      kind: "conversion",
      cid: B,
      site: "getclark.app",
      viewer: A,
      returning: true,
      video: "clark-vsl",
      variant: "cut-b",
      value: 497.5,
      currency: "EUR",
      orderId: "order-1042",
    },
  });
  // What the browser sends is what a collector accepts, within its size cap.
  if (r.ok) {
    expect(parseConversion(JSON.parse(JSON.stringify(r.body)))).toEqual(r.body);
    expect(JSON.stringify(r.body).length).toBeLessThan(CONVERSION_MAX_BYTES);
  }
});

test("convert dedupes on the order id across page loads", () => {
  const store = memory();
  const input = { value: 497, currency: "EUR", id: "1042", collect: "https://x.test/api/vsl" };
  expect(prepareConversion(input, ctx(store)).ok).toBe(true);
  resetPageState(); // a reload: only storage remembers
  expect(prepareConversion(input, ctx(store, { path: "/other" }))).toEqual({ ok: false, reason: "already sent" });
  expect(prepareConversion({ ...input, id: "1043" }, ctx(store)).ok).toBe(true);
});

test("without an order id, the same sale on the same page counts once until the record expires", () => {
  const store = memory();
  const input = { value: 97, currency: "USD", collect: "https://x.test/api/vsl" };
  expect(prepareConversion(input, ctx(store)).ok).toBe(true);
  resetPageState();
  expect(prepareConversion(input, ctx(store)).ok).toBe(false);
  expect(prepareConversion({ ...input, value: 98 }, ctx(store)).ok).toBe(true);
  resetPageState();
  expect(prepareConversion(input, ctx(store, { now: 1_000 + CONVERTED_TTL_MS })).ok).toBe(true);
});

test("missing storage: convert still sends, unattributed, and dedupes within the page", () => {
  for (const store of [blocked, null]) {
    resetPageState();
    const input = { value: 10, currency: "EUR", id: "o-1", collect: "https://x.test/api/vsl" };
    const r = prepareConversion(input, ctx(store));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.video).toBeUndefined();
    expect(prepareConversion(input, ctx(store))).toEqual({ ok: false, reason: "already sent" });
  }
});

test("convert refuses bad input and a missing endpoint, and records nothing for them", () => {
  const store = memory();
  const c = ctx(store);
  expect(prepareConversion({ value: -1, currency: "EUR", collect: "x" }, c).ok).toBe(false);
  expect(prepareConversion({ value: "lots", currency: "EUR", collect: "x" }, c).ok).toBe(false);
  expect(prepareConversion({ value: 1e9, currency: "EUR", collect: "x" }, c).ok).toBe(false);
  expect(prepareConversion({ value: 1, currency: "euro", collect: "x" }, c).ok).toBe(false);
  expect(prepareConversion({ value: 1, currency: "EUR", id: "me@example.com", collect: "x" }, c).ok).toBe(false);
  expect(prepareConversion({ value: 1, currency: "EUR" }, c)).toEqual({
    ok: false,
    reason: "no collect endpoint: pass { collect } or watch a player with collect first",
  });
  expect(store.data.has("keepwatch:converted")).toBe(false);
});

test("the dedupe record is capped and drops expired entries", () => {
  const store = memory();
  for (let i = 0; i < 80; i++) firstSend(store, `k${i}`, i);
  const list = JSON.parse(store.data.get("keepwatch:converted")!);
  expect(list.length).toBe(50);
  expect(list[0].k).toBe("k30");
  firstSend(store, "late", CONVERTED_TTL_MS + 100);
  expect(JSON.parse(store.data.get("keepwatch:converted")!).map((e: { k: string }) => e.k)).toEqual(["late"]);
});

test("parseConversion is strict: a sale with a bad field is refused whole", () => {
  const ok = { kind: "conversion" as const, cid: B, site: "getclark.app", viewer: A, value: 497, currency: "EUR" };
  expect(parseConversion(ok)).toEqual({ ...ok, returning: false });
  expect(parseConversion({ ...ok, kind: undefined })).toBeNull();
  expect(parseConversion({ ...ok, value: "497" })).toBeNull();
  expect(parseConversion({ ...ok, value: Number.NaN })).toBeNull();
  expect(parseConversion({ ...ok, value: -5 })).toBeNull();
  expect(parseConversion({ ...ok, currency: "EU" })).toBeNull();
  expect(parseConversion({ ...ok, viewer: "short" })).toBeNull();
  expect(parseConversion({ ...ok, video: "clark-vsl" })).toBeNull(); // video without variant
  expect(parseConversion({ ...ok, orderId: "a b" })).toBeNull();
  expect(parseConversion({ ...ok, returning: "yes" })).toBeNull();
  expect(parseConversion({ ...ok, value: 9.999 })?.value).toBe(10);
  expect(parseConversion({ ...ok, orderId: 1042 })?.orderId).toBe("1042");
  expect(parseConversion({ ...ok, extra: "dropped" })).not.toHaveProperty("extra");
  expect(parseConversion([ok])).toBeNull();
});

test("a conversion is stored once per order and site, or once per send without one", () => {
  expect(conversionKey({ site: "a.test", cid: B, orderId: "1042" })).toBe("order:a.test:1042");
  expect(conversionKey({ site: "b.test", cid: B, orderId: "1042" })).toBe("order:b.test:1042");
  expect(conversionKey({ site: "a.test", cid: B })).toBe(`cid:${B}`);
});
