# Keepwatch

A Vidalytics-style VSL player for any Vimeo link, plus the watch analytics behind it. One script tag, one HTML tag, and it works on any site: plain HTML, Webflow, WordPress, GoHighLevel, Next.js.

- **Smart autoplay:** starts muted with a "click for sound" card. The click restarts the video from 0:00 with sound, so nobody hears the pitch from the middle.
- **Fast progress bar:** runs ahead early and slows down later, so a long video feels short. It still ends exactly at the end. No seeking.
- **Resume:** returning viewers get "Continue watching (2:14)" or "Start over".
- **Timed CTA:** your button appears when the offer starts (`cta-at="6:11"`), inside the player and anywhere on the page you mark with `data-keepwatch-gate`.
- **A/B variants:** split traffic over several cuts; each viewer keeps theirs.
- **Analytics:** one row per viewing session (views, plays with sound, unmute rate, drop-off curve, CTA reached and clicked, finishes), sent to a collector you choose. No cookies, no IP, no personal data.
- English, Dutch and Russian built in; restyle with CSS custom properties.

## Drop it on any page

```html
<script src="https://cdn.jsdelivr.net/npm/keepwatch@0/dist/keepwatch.js" defer></script>

<keep-watch
  src="https://vimeo.com/1226915932"
  video="clark-vsl"
  cta-at="6:11"
  cta-href="#book"
  collect="https://getclark.app/api/vsl"
></keep-watch>

<section id="book" data-keepwatch-gate>
  <!-- hidden until the video reaches 6:11, or at once if the video cannot load -->
</section>
```

Unlisted Vimeo videos work too: paste the link with its hash (`https://vimeo.com/123456789/abcdef1234`).

### Attributes

| Attribute | What it does | Default |
|---|---|---|
| `src` | Vimeo link or id | required (or `variants`) |
| `variants` | A/B: `[{"id":"long","src":"…","weight":1},{"id":"short","src":"…","weight":1}]` | |
| `video` | Analytics id for this video, e.g. `clark-vsl` | `vimeo-<id>` |
| `cta-at` | When the CTA appears: `6:11`, `371` | no timed CTA |
| `cta-href` | CTA target. `#id` scrolls on the page; a same-site link carries `utm_*` along | |
| `cta-text` | CTA label | "Book your call" per language |
| `cta-target` | `_blank` to open in a new tab | |
| `autoplay` | `load` (muted, at once), `inview` (muted, when half on screen), `click` (with sound, for modals opened by a click), `none` (poster + play button) | `load` |
| `collect` | Analytics endpoint. Leave out to send nothing | |
| `placement` | Where on the site it sits, for the dashboard: `main`, `hero`, `popup` | `main` |
| `poster` | Poster image | Vimeo's thumbnail |
| `lang` | `en`, `nl`, `ru` | the page's `<html lang>` |
| `label` | Accessible name of the video | "Video" |
| `bar-curve` | How far ahead the bar runs. `1` is honest | `2.2` |

Reduced motion and Save-Data turn autoplay into a click-to-play poster.

### Styling

```css
keep-watch {
  --kw-accent: #2f6bff;   /* buttons, bar, unmute card */
  --kw-on-accent: #fff;
  --kw-radius: 16px;
  --kw-font: inherit;
  --kw-aspect: 16 / 9;
}
keep-watch::part(cta) { /* the CTA button */ }
```

### Events

Every event bubbles out of the element with `detail: { video, variant, time }`:
`keepwatch:ready`, `keepwatch:play`, `keepwatch:unmute`, `keepwatch:pause`, `keepwatch:cta-shown`, `keepwatch:cta-click`, `keepwatch:ended`, `keepwatch:error`.

```js
document.addEventListener("keepwatch:cta-click", (e) => fbq("track", "Lead", e.detail));
```

### Gates

Anything with `data-keepwatch-gate` is hidden until a player on the page unlocks its CTA, and stays open for returning viewers who already got that far. If the video fails to load, gates open, so a page never strands a visitor. If the script itself never loads, gates stay visible (fail-open).

## React and Next.js

```tsx
import { Keepwatch, KeepwatchGate } from "keepwatch/react";

<Keepwatch src="https://vimeo.com/1226915932" video="clark-vsl" ctaAt="6:11" ctaHref="#book"
           collect="https://getclark.app/api/vsl" autoplay="inview" className={styles.frame} />
<KeepwatchGate><BookingSection /></KeepwatchGate>
```

Safe to render from server components; the element registers in the browser on first mount. To avoid gated content flashing before hydration, add this to your global CSS:

```css
html:not([data-keepwatch-unlocked]) [data-keepwatch-gate] { display: none !important; }
```

## Analytics

Each player posts its whole session state as JSON (`text/plain`, so no CORS preflight) to `collect`: on start, every 30 seconds of listening, on sound on, CTA shown, CTA clicked, end, and page hide (`sendBeacon`). The collector keeps one row per `sid` and merges by maximum, so lost or late reports cost nothing.

Watch time and the drop-off curve only count seconds with the sound on. A muted autoplay is a *view*; a *play* is someone who listened.

Build a collector with `keepwatch/server`:

```ts
import { parseBeat, mergeBeat, summarise, originAllowed, BEAT_MAX_BYTES } from "keepwatch/server";

if (!originAllowed(request.headers.get("origin"), ["getclark.app", "*.weblyfe.nl"])) return new Response(null, { status: 403 });
const beat = parseBeat(JSON.parse(await request.text()));   // null if malformed
const row = mergeBeat(existingRowOrNull, beat);              // upsert by beat.sid
const stats = summarise(rowsForOneVideo, durationSec);       // tiles + retention curve
```

The reference collector and dashboard live in getclark.app (`/api/vsl`, `/admin/vsl-analytics`). To report from a new site, add its hostname to the allowlist there.

## Develop

```sh
bun install
bun test          # core rules
bun run build     # dist/keepwatch.js (CDN), dist/index.js, dist/server.js, dist/react.js + types
bunx serve .      # then open /demo
```

`src/core.ts` holds every rule as a pure, tested function; `src/element.ts` is the DOM side; `src/server.ts` is the collector contract. Change a rule in core, test it, then wire it.

## Publish

```sh
npm version patch
npm publish
```

jsDelivr serves `https://cdn.jsdelivr.net/npm/keepwatch@0/dist/keepwatch.js` within minutes of a publish. Pin a major (`@0`) on sites so a breaking release never lands unannounced.
