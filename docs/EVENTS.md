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
| `viewer` | string, `[A-Za-z0-9_-]{16,64}`, optional | Anonymous viewer id, below. New with conversion tracking; a malformed value is dropped and the beat still counts. |
| `returning` | boolean, optional | The viewer had an earlier visit. Sent with `viewer`; absent when `viewer` is. |
| `utmSource`, `utmMedium`, `utmCampaign`, `utmContent` | string, max 120, optional | From the page URL's `utm_*` parameters. |

A slug is lower case, `[a-z0-9][a-z0-9-]{0,39}`. A missing boolean reads as `false`. Unknown fields are dropped. Beats from older players have no `viewer` or `returning` and parse exactly as before.

## Conversion

A sale, sent from a thank-you page. Validated by `parseConversion`, capped at `CONVERSION_MAX_BYTES` (1024). Strict: a message with any malformed field is refused whole, since a wrong number in revenue is worse than a missing one. Store each one under `conversionKey(c)`, which is unique: `order:<site>:<orderId>` when there is an order id, otherwise `cid:<cid>`.

Fires: once per `keepwatch.convert()` call or `<keep-watch-convert>` element, unless this browser already sent the same conversion (below).

| Field | Type | Notes |
|---|---|---|
| `kind` | `"conversion"` | Required. |
| `cid` | string, `[A-Za-z0-9_-]{16,64}` | Random per send, so a retried send is stored once. Required. |
| `site` | string, hostname, max 120 | The thank-you page's hostname. Required. |
| `viewer` | string, `[A-Za-z0-9_-]{16,64}` | The anonymous viewer id. Required. |
| `returning` | boolean | The viewer had an earlier visit. A missing value reads as `false`. |
| `video` | slug, optional | The last video this browser started. Sent with `variant` or not at all. |
| `variant` | slug, optional | The variant of that video. |
| `value` | number, 0 to 10000000 | The sale in the currency's major unit (`497.5` is 497.50), rounded to cents. Must be a JSON number. Required. |
| `currency` | string, `[A-Z]{3}` | ISO 4217. Required. |
| `orderId` | string, `[A-Za-z0-9._:#/-]{1,64}`, optional | The shop's order id. No `@` or spaces, so it cannot carry an email address. |

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

`keepwatch.convert({ value, currency, id?, collect? })` returns `true` when a message was sent and `false` when it was refused (invalid input or no endpoint, with a console warning) or already sent. In a bundle: `import { convert } from "keepwatch"`.

- `collect`: where to send it. Default: the `collect` of the last player this browser watched on this site.
- `video` and `variant`: always the last video this browser started on this site (stored in localStorage when playback starts). With no such video, or no storage, the conversion is sent without them.
- Dedupe in the browser: an `id` is sent once per browser for 30 days. Without an `id`, the same value and currency on the same page path is sent once for 30 days, so reloading the thank-you page does not count twice. With storage blocked, dedupe holds for the page view only; the collector's `conversionKey` still stores each order id once.

## Viewer id and returning viewers

`localStorage["keepwatch:viewer"]` holds `{ id, visits, last }`: a random 32-character id, a visit count and the time of the last page view. Page views less than 30 minutes apart (`VISIT_GAP_MS`) are one visit; a viewer is **returning** once they have more than one visit. It is read once per page view, so every player and every conversion on a page agree.

Storage blocked or throwing: the id is random for this page view only, `returning` is `false`, and the player plays as always.

Other keys: `keepwatch:last` (`{ video, variant, collect, at }`, the last video started) and `keepwatch:converted` (the dedupe record, at most 50 entries). `keepwatch:<video>` holds each video's variant, position and furthest point, as before.

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
