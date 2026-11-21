import { beforeEach, expect, test } from "bun:test";
import { CONVERSION_MAX_BYTES, MAX_VALUE, conversionKey, parseConversion } from "./core.ts";
import { createHash } from "node:crypto";
import { load, save } from "./store.ts";
import {
  CONVERTED_TTL_MS,
  UNNAMED_TTL_MS,
  VISIT_GAP_MS,
  lastWatched,
  prepareConversion,
  recordSent,
  rememberWatched,
  resetPageState,
  sendConversion,
  sha256Hex,
  visit,
  type ConvertContext,
  type KV,
  type Transport,
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
  expect(JSON.parse(store.data.get("keepwatch/viewer")!)).toEqual({ id: A, visits: 1, last: 1_000 });
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
  store.data.set("keepwatch/viewer", JSON.stringify({ id: "me@example.com", visits: 9, last: 0 }));
  expect(visit(store, 10 ** 9, ids(B))).toEqual({ id: B, returning: false });
  store.data.set("keepwatch/viewer", "{not json");
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
  store.data.set("keepwatch/last", JSON.stringify({ video: "<script>", variant: "a" }));
  expect(lastWatched(store)).toBeNull();
  expect(lastWatched(blocked)).toBeNull();
  rememberWatched(blocked, { video: "v", variant: "a", at: 0 }); // does not throw
});

function ctx(store: KV | null, over: Partial<ConvertContext> = {}): ConvertContext {
  return { store, viewer: { id: A, returning: true }, site: "getclark.app", path: "/thanks", now: 1_000, cid: B, ...over };
}

const hex = (s: string) => createHash("sha256").update(s).digest("hex");
const ok: Transport = async () => true;
const COLLECT = "https://x.test/api/vsl";

test("convert credits the viewer and the last watched video, and sends only a hash of the order id", async () => {
  const store = memory();
  rememberWatched(store, { video: "clark-vsl", variant: "cut-b", collect: "https://getclark.app/api/vsl", at: 0 });
  const sent: string[] = [];
  const r = await sendConversion({ value: "497.5", currency: "eur", id: "order-1042" }, ctx(store), async (_e, json) => {
    sent.push(json);
    return true;
  });
  const orderHash = hex("keepwatch:getclark.app:order-1042");
  expect(r.ok && r.body).toEqual({
    kind: "conversion",
    cid: B,
    site: "getclark.app",
    viewer: A,
    returning: true,
    video: "clark-vsl",
    variant: "cut-b",
    value: 497.5,
    currency: "EUR",
    orderHash,
  });
  expect(sent.length).toBe(1);
  expect(sent[0]).not.toContain("order-1042");
  // What the browser sends is what a collector accepts, within its size cap.
  expect(parseConversion(JSON.parse(sent[0]))).toEqual(JSON.parse(sent[0]));
  expect(sent[0].length).toBeLessThan(CONVERSION_MAX_BYTES);
});

test("without SubtleCrypto the order id is left out, never sent in the clear", async () => {
  expect(await sha256Hex("x", null)).toBeNull();
  const broken = { digest: async () => Promise.reject(new Error("no")) } as unknown as SubtleCrypto;
  expect(await sha256Hex("x", broken)).toBeNull();
  const store = memory();
  const r = await prepareConversion({ value: 10, currency: "EUR", id: "1042", collect: COLLECT }, ctx(store, { subtle: null }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.body.orderHash).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain("1042");
    expect(r.key).toBe("page:/thanks|10|EUR");
  }
});

test("convert dedupes on the order across page loads, for 30 days", async () => {
  const store = memory();
  const input = { value: 497, currency: "EUR", id: "1042", collect: COLLECT };
  expect((await sendConversion(input, ctx(store), ok)).ok).toBe(true);
  resetPageState(); // a reload: only storage remembers
  expect(await sendConversion(input, ctx(store, { path: "/other", now: 1_000 + 29 * 86_400_000 }), ok)).toEqual({
    ok: false,
    reason: "already sent",
  });
  expect((await sendConversion({ ...input, id: "1043" }, ctx(store), ok)).ok).toBe(true);
  resetPageState();
  expect((await sendConversion(input, ctx(store, { now: 1_000 + CONVERTED_TTL_MS }), ok)).ok).toBe(true);
});

test("without an order id, a reload counts once, and the same purchase the next day counts again", async () => {
  const store = memory();
  const input = { value: 97, currency: "USD", collect: COLLECT };
  expect((await sendConversion(input, ctx(store), ok)).ok).toBe(true);
  resetPageState();
  expect((await sendConversion(input, ctx(store, { now: 1_000 + UNNAMED_TTL_MS - 1 }), ok)).ok).toBe(false);
  expect((await sendConversion({ ...input, value: 98 }, ctx(store), ok)).ok).toBe(true);
  resetPageState();
  const nextDay = 1_000 + 24 * 60 * 60 * 1000;
  const again = await sendConversion(input, ctx(store, { now: nextDay }), ok);
  expect(again.ok && again.sent).toBe(true);
});

test("a failed send is not remembered, so a reload retries it", async () => {
  const store = memory();
  const input = { value: 497, currency: "EUR", id: "1042", collect: COLLECT };
  const down: Transport = async () => false;
  const first = await sendConversion(input, ctx(store), down);
  expect(first.ok && first.sent).toBe(false);
  expect(store.data.has("keepwatch/converted")).toBe(false);
  const retry = await sendConversion(input, ctx(store), ok);
  expect(retry.ok && retry.sent).toBe(true);
  expect((await sendConversion(input, ctx(store), ok)).ok).toBe(false);
});

test("two overlapping calls send once; a failed one releases the key for a retry", async () => {
  for (const store of [memory(), null]) {
    resetPageState();
    const sends: string[] = [];
    let release!: (v: boolean) => void;
    const slow: Transport = (_e, json) => {
      sends.push(json);
      return new Promise((r) => (release = r));
    };
    for (const input of [
      { value: 97, currency: "USD", collect: COLLECT },
      { value: 497, currency: "EUR", id: "1042", collect: COLLECT },
    ]) {
      sends.length = 0;
      const a = sendConversion(input, ctx(store), slow);
      const b = sendConversion(input, ctx(store, { cid: "c".repeat(32) }), slow);
      expect(await b).toEqual({ ok: false, reason: "already sent" });
      release(false); // the first send fails
      const first = await a;
      expect(first.ok && first.sent).toBe(false);
      expect(sends.length).toBe(1);
      const retry = await sendConversion(input, ctx(store, { cid: "d".repeat(32) }), ok);
      expect(retry.ok && retry.sent).toBe(true);
    }
  }
});

test("without SubtleCrypto, the no-order cid falls back to a stored random id, kept inside the window", async () => {
  const store = memory();
  const input = { value: 97, currency: "USD", collect: COLLECT };
  const down: Transport = async () => false;
  const first = await sendConversion(input, ctx(store, { subtle: null, cid: "c".repeat(32) }), down);
  resetPageState(); // another page load (or tab): only storage remembers
  const retry = await sendConversion(input, ctx(store, { subtle: null, cid: "d".repeat(32), now: 1_000 + UNNAMED_TTL_MS - 1 }), ok);
  expect(first.ok && first.body.cid).toBe("c".repeat(32));
  expect(retry.ok && retry.body.cid).toBe("c".repeat(32));
  resetPageState();
  const later = await sendConversion(input, ctx(store, { subtle: null, cid: "e".repeat(32), now: 1_000 + 2 * UNNAMED_TTL_MS }), ok);
  expect(later.ok && later.sent && later.body.cid).toBe("e".repeat(32));
});

test("missing storage: convert still sends, unattributed, and dedupes within the page", async () => {
  for (const store of [blocked, null]) {
    resetPageState();
    const input = { value: 10, currency: "EUR", id: "o-1", collect: COLLECT };
    const r = await sendConversion(input, ctx(store), ok);
    expect(r.ok && r.sent).toBe(true);
    if (r.ok) expect(r.body.video).toBeUndefined();
    expect(await sendConversion(input, ctx(store), ok)).toEqual({ ok: false, reason: "already sent" });
  }
});

test("convert refuses bad input and a missing endpoint, and records nothing for them", async () => {
  const store = memory();
  const c = ctx(store);
  for (const input of [
    { value: -1, currency: "EUR", collect: COLLECT },
    { value: "lots", currency: "EUR", collect: COLLECT },
    { value: MAX_VALUE + 0.01, currency: "EUR", collect: COLLECT },
    { value: 1, currency: "euro", collect: COLLECT },
    { value: 1, currency: "EUR", id: "me@example.com", collect: COLLECT },
  ]) {
    expect((await sendConversion(input, c, ok)).ok).toBe(false);
  }
  expect(await sendConversion({ value: 1, currency: "EUR" }, c, ok)).toEqual({
    ok: false,
    reason: "no collect endpoint: pass { collect } or watch a player with collect first",
  });
  expect(store.data.has("keepwatch/converted")).toBe(false);
});

test("the dedupe record is capped and drops expired entries", () => {
  const store = memory();
  for (let i = 0; i < 80; i++) recordSent(store, `order:k${i}`, i);
  const list = JSON.parse(store.data.get("keepwatch/converted")!);
  expect(list.length).toBe(50);
  expect(list[0].k).toBe("order:k30");
  recordSent(store, "order:late", CONVERTED_TTL_MS + 100);
  expect(JSON.parse(store.data.get("keepwatch/converted")!).map((e: { k: string }) => e.k)).toEqual(["order:late"]);
});

test("parseConversion is strict: a sale with a bad field is refused whole", () => {
  const good = { kind: "conversion" as const, cid: B, site: "getclark.app", viewer: A, value: 497, currency: "EUR" };
  const h = hex("x");
  expect(parseConversion(good)).toEqual({ ...good, returning: false });
  expect(parseConversion({ ...good, orderHash: h })?.orderHash).toBe(h);
  for (const bad of [
    { ...good, kind: undefined },
    { ...good, value: "497" },
    { ...good, value: Number.NaN },
    { ...good, value: -5 },
    { ...good, value: MAX_VALUE + 1 },
    { ...good, currency: "EU" },
    { ...good, viewer: "short" },
    { ...good, viewer: "A".repeat(32) }, // not the random format: upper case
    { ...good, viewer: "a".repeat(33) },
    { ...good, cid: "abc_defghijklmnopqrstuvwxyz012345" },
    { ...good, video: "clark-vsl" }, // video without variant
    { ...good, orderHash: h.toUpperCase() },
    { ...good, orderHash: h.slice(1) },
    { ...good, orderId: "1042" }, // a raw order id is never accepted
    { ...good, returning: "yes" },
    [good],
  ]) {
    expect(parseConversion(bad)).toBeNull();
  }
  expect(parseConversion({ ...good, value: 9.999 })?.value).toBe(10);
  expect(parseConversion({ ...good, extra: "dropped" })).not.toHaveProperty("extra");
});

test("a conversion is stored once per order and site, or once per send without one", () => {
  const h = hex("x");
  expect(conversionKey({ site: "a.test", cid: B, orderHash: h })).toBe(`order:a.test:${h}`);
  expect(conversionKey({ site: "b.test", cid: B, orderHash: h })).toBe(`order:b.test:${h}`);
  expect(conversionKey({ site: "a.test", cid: B })).toBe(`cid:${B}`);
});

test("a video named viewer, last, converted or cids keeps its playback state apart from tracking", async () => {
  const store = memory();
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  g.localStorage = store;
  try {
    // A resume position saved by 0.3.0 under its playback key, before the upgrade.
    store.data.set("keepwatch:viewer", JSON.stringify({ variant: "a", pos: 42, furthest: 60 }));
    for (const video of ["last", "converted", "cids"]) save(video, { variant: "a", pos: 7 });
    const who = visit(store, 1_000, ids(A));
    rememberWatched(store, { video: "viewer", variant: "a", collect: COLLECT, at: 1_000 });
    // subtle: null takes the stored-cid path, so all four tracking keys are written.
    await sendConversion({ value: 97, currency: "USD", collect: COLLECT }, ctx(store, { subtle: null }), ok);
    save("viewer", { pos: 50 });
    // Playback survived the tracking writes, and tracking survived the playback write.
    expect(load("viewer")).toEqual({ variant: "a", pos: 50, furthest: 60 });
    for (const video of ["last", "converted", "cids"]) expect(load(video).pos).toBe(7);
    expect(who.id).toBe(A);
    expect(visit(store, 2_000).id).toBe(A);
    expect(lastWatched(store)?.video).toBe("viewer");
    expect([...store.data.keys()].filter((k) => k.startsWith("keepwatch/")).sort()).toEqual([
      "keepwatch/cids",
      "keepwatch/converted",
      "keepwatch/last",
      "keepwatch/viewer",
    ]);
  } finally {
    g.localStorage = before;
  }
});

test("two tabs (two module instances, one storage) send the same cid for one no-order sale", async () => {
  const store = memory();
  // A query string gives a separate module instance: separate in-page state, like a second tab.
  const tab = (name: string) => import(`./viewer.ts?tab=${name}`) as Promise<typeof import("./viewer.ts")>;
  const tabA = await tab("a");
  const tabB = await tab("b");
  expect(tabA.sendConversion).not.toBe(tabB.sendConversion); // really two instances
  const input = { value: 97, currency: "USD", collect: COLLECT };
  const bodies: string[] = [];
  const slow: Transport = async (_e, json) => {
    bodies.push(json);
    await new Promise((r) => setTimeout(r, 5));
    return true;
  };
  // Both tabs start before either has recorded anything, each with its own random candidate.
  const now = 10 * UNNAMED_TTL_MS + 5;
  const [a, b] = await Promise.all([
    tabA.sendConversion(input, ctx(store, { now, cid: "c".repeat(32) }), slow),
    tabB.sendConversion(input, ctx(store, { now: now + 60_000, cid: "d".repeat(32) }), slow),
  ]);
  expect(a.ok && b.ok).toBe(true);
  const cids = bodies.map((j) => JSON.parse(j).cid);
  expect(cids.length).toBe(2);
  expect(cids[0]).toBe(cids[1]);
  expect(cids[0]).toMatch(/^[0-9a-z]{32}$/);
  expect(parseConversion(JSON.parse(bodies[0]))).not.toBeNull();
  expect(cids[0]).toBe(hex(`keepwatch-cid:${A}|page:/thanks|97|USD|10`).slice(0, 32));
  // Another viewer, another window, or another sale: another cid.
  expect(await tabA.windowCid(B, "page:/thanks|97|USD", now, crypto.subtle)).not.toBe(cids[0]);
  expect(await tabA.windowCid(A, "page:/thanks|97|USD", now + UNNAMED_TTL_MS, crypto.subtle)).not.toBe(cids[0]);
  expect(await tabA.windowCid(A, "page:/thanks|98|USD", now, crypto.subtle)).not.toBe(cids[0]);
  expect(await tabA.windowCid(A, "k", now, null)).toBeNull();
});
