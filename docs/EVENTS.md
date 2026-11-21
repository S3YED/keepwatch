# Event contract

Everything Keepwatch sends or dispatches, with every field, its type and when it fires. The validators in `src/core.ts` (`parseBeat`, `parseConversion`, exported from `keepwatch/server`) are the source of truth; this page describes them.

Keepwatch sends two messages to a collector and dispatches DOM events for pixels and tag managers. Nothing it sends holds personal data: no cookie, no IP, no user agent, no name or email. The viewer id is random and first-party.

## Transport

Both messages go to the player's `collect` URL as a JSON body with `content-type: text/plain` (`sendBeacon`, or `fetch` with `mode: "no-cors"` and `keepalive`). That makes them simple requests: no CORS preflight, and the collector never answers with anything a page reads. A collector checks the `Origin` header against its allowlist (`originAllowed`) and that the message's `site` matches it.

A collector tells the two apart by `kind`: a conversion has `kind: "conversion"`; a session beat has no `kind`.

## Session beat

One viewing session of one player, the whole state so far. Validated by `parseBeat`, capped at `BEAT_MAX_BYTES` (2048). The collector keeps one row per `sid` and merges with `mergeBeat`: numbers only grow, flags only turn on, so a lost or late beat costs nothing.

Fires: when the video first plays, every 30 seconds of listening, on sound on, CTA shown, CTA clicked, the end, page hide, and when the player is removed or reconfigured. Only when `collect` is set and the video has started.

| Field | Type | Notes |
|---|---|---|
| `sid` | string, `[A-Za-z0-9_-]{16,64}` | Random per session (per player, per page view). Required. |
| `site` | string, hostname, max 120 | `location.hostname`, lower case. Required. |
| `video` | slug, max 40 | The `video` attribute, or the first variant's id. Required. |
| `variant` | slug, max 40 | The variant this browser was assigned. Required. |
| `placement` | slug, max 40 | The `placement` attribute, default `main`. Required. |
| `locale` | string, `[a-z]{2}` | The player's language. Required. |
| `durationSec` | integer, 0 to 14400 | Video length. Required. |
| `furthestSec` | integer, 0 to 14400 | Furthest point reached with sound on. Required. |
| `watchedSec` | integer, 0 to 14400 | Seconds listened with sound on. Required. |
| `unmuted` | boolean | The viewer turned sound on. |
| `resumed` | boolean | Continued where an earlier visit stopped. |
| `ctaShown` | boolean | The timed CTA appeared. |
| `ctaClicked` | boolean | The CTA was clicked. |
| `completed` | boolean | Reached the end. |
| `mobile` | boolean | Coarse pointer (touch screen). |
| `viewer` | string, `[0-9a-z]{32}`, optional | Anonymous viewer id, below: exactly the random format the player makes. New with conversion tracking; any other value is dropped and the beat still counts. |
| `returning` | boolean, optional | The viewer had an earlier visit. Sent with `viewer`; absent when `viewer` is. |
| `utmSource`, `utmMedium`, `utmCampaign`, `utmContent` | string, max 120, optional | From the page URL's `utm_*` parameters. |

A slug is lower case, `[a-z0-9][a-z0-9-]{0,39}`. A missing boolean reads as `false`. Unknown fields are dropped. Beats from older players have no `viewer` or `returning` and parse exactly as before.

## Conversion

A sale, sent from a thank-you page. Validated by `parseConversion`, capped at `CONVERSION_MAX_BYTES` (1024). Strict: a message with any malformed field is refused whole, since a wrong number in revenue is worse than a missing one. Store each one under `conversionKey(c)`, which is unique: `order:<site>:<orderHash>` when there is an order hash, otherwise `cid:<cid>`.

**Unverified.** A conversion is reported by the browser, like any pixel. `Origin` keeps honest pages apart but is not authentication: anyone who can reach the collector can send a conversion, with any value, or send an order's hash first. A collector should store it marked as browser-reported (getclark.app stores `source: "browser"` and labels it "reported by the browser, unverified"), refuse values above `MAX_VALUE` (100000), and cap each viewer id at `MAX_CONVERSIONS_PER_VIEWER_PER_DAY` (5) per 24 hours. Revenue you can trust needs a server-to-server postback from the shop, signed with a per-site secret; that is a planned follow-up and needs the site owner to issue the secret.

Fires: once per `keepwatch.convert()` call or `<keep-watch-convert>` element, unless this browser already sent the same conversion (below).

| Field | Type | Notes |
|---|---|---|
| `kind` | `"conversion"` | Required. |
| `cid` | string, `[0-9a-z]{32}` | Identifies the sale for the collector, so a retried send is stored once. Random, or without an order id derived per 30-minute window (below). Required. |
| `site` | string, hostname, max 120 | The thank-you page's hostname. Required. |
| `viewer` | string, `[0-9a-z]{32}` | The anonymous viewer id. Required. |
| `returning` | boolean | The viewer had an earlier visit. A missing value reads as `false`. |
| `video` | slug, optional | The last video this browser started. Sent with `variant` or not at all. |
| `variant` | slug, optional | The variant of that video. |
| `value` | number, 0 to 100000 | The sale in the currency's major unit (`497.5` is 497.50), rounded to cents. Must be a JSON number. Required. |
| `currency` | string, `[A-Z]{3}` | ISO 4217. Required. |
| `orderHash` | string, `[0-9a-f]{64}`, optional | SHA-256 hex of `keepwatch:<site>:<order id>`, computed in the browser with SubtleCrypto, so the order id itself is never sent. Absent when no id was given or SubtleCrypto is unavailable (plain http, old browsers). A raw `orderId` field is refused. |

### Sending one

```html
<script src="https://getclark.app/keepwatch.js"></script>
<script>keepwatch.convert({ value: 497, currency: "EUR", id: "order-1042" });</script>
```

or, without a script of your own:

```html
<script src="https://getclark.app/keepwatch.js"></script>
<keep-watch-convert value="497" currency="EUR" order-id="order-1042"></keep-watch-convert>
```

`keepwatch.convert({ value, currency, id?, collect? })` returns a promise: `true` when the message was handed to the network, `false` when it was refused (invalid input or no endpoint, with a console warning), already sent, or the send failed. In a bundle: `import { convert } from "keepwatch"`.

- `collect`: where to send it. Default: the `collect` of the last player this browser watched on this site.
- `video` and `variant`: always the last video this browser started on this site (stored in localStorage when playback starts). With no such video, or no storage, the conversion is sent without them.
- `id`: hashed before sending (above). Letters, digits and `. _ : # / -`, 1 to 64.
- Dedupe in the browser, recorded only after the send succeeded (`sendBeacon` accepted it, or `fetch` went out without a network error), so a failed send is retried on reload. An order is sent once per browser for 30 days. Without an order hash, the same value and currency on the same page path is sent once within 30 minutes (`UNNAMED_TTL_MS`): a reload does not count twice, a second purchase the next day does count. The tradeoff: without an order id, a thank-you page reloaded after 30 min counts again; pass an order id to dedupe for good. Without an order id the `cid` is deterministic: the first 32 hex characters of SHA-256 of the viewer id, the dedupe key and the 30-minute window number (`windowCid`). Two tabs, or a retry, in the same window send the same `cid` with no cross-tab lock, and the collector stores the sale once. Two sends either side of a window boundary get different cids. Without SubtleCrypto it falls back to a random `cid` kept in `keepwatch/cids` for the window, which two tabs racing can still split. Two overlapping calls for the same sale send once: the second resolves `false` while the first is in flight, and a failed first send releases it for a retry. With storage blocked, dedupe holds for the page view only; the collector's `conversionKey` still stores each order once.

## Viewer id and returning viewers

`localStorage["keepwatch/viewer"]` holds `{ id, visits, last }`: a random 32-character id, a visit count and the time of the last page view. Page views less than 30 minutes apart (`VISIT_GAP_MS`) are one visit; a viewer is **returning** once they have more than one visit. It is read once per page view, so every player and every conversion on a page agree.

Storage blocked or throwing: the id is random for this page view only, `returning` is `false`, and the player plays as always.

Other keys: `keepwatch/last` (`{ video, variant, collect, at }`, the last video started), `keepwatch/converted` (the dedupe record, at most 50 entries) and `keepwatch/cids` (the send id per sale inside its window, at most 50). Tracking keys start `keepwatch/`; playback keys are `keepwatch:<video>`, each video's variant, position and furthest point, unchanged from 0.3.0. So no video id (not even `viewer`) can collide with tracking state, and saved resume positions survive the upgrade.

## DOM events

Dispatched by `<keep-watch>`; they bubble and are composed. `detail` is `{ video, variant, time }`.

| Event | When |
|---|---|
| `keepwatch:ready` | The player is set up. |
| `keepwatch:play` | Playback starts or resumes. |
| `keepwatch:unmute` | Sound on. |
| `keepwatch:pause` | Paused. |
| `keepwatch:cta-shown` | The timed CTA appears. |
| `keepwatch:cta-click` | The CTA is clicked. |
| `keepwatch:ended` | The video ends. |
| `keepwatch:error` | The video could not load. |
| `keepwatch:progress` | 25, 50, 75 and 90 percent reached with sound on, once each per session; `detail.percent` added. |

Dispatched on `window` by `keepwatch.convert()`:

| Event | When |
|---|---|
| `keepwatch:conversion` | A conversion is sent. `detail` is the conversion message above. |
