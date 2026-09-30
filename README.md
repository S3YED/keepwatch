# Keepwatch

A Vidalytics-style VSL player for Vimeo, YouTube, Loom and plain video files (MP4, WebM, HLS), plus the watch analytics behind it. One script tag, one HTML tag, and it works on any site: plain HTML, Webflow, WordPress, GoHighLevel, Next.js.

- **Smart autoplay:** starts muted behind a "Your video is playing / Click to unmute" card, with no controls and no progress bar, so the preview never looks like minutes already missed. The click restarts the video from 0:00 with sound, so nobody hears the pitch from the middle. Optionally loops the first seconds (`preview-loop`).
- **Player chrome:** play/pause, back 10 seconds, sound, an elapsed-time counter, a speed menu and full screen, in pill groups that fade out while the video plays. Lucide icons, no emoji.
- **Fast progress bar:** runs ahead early and slows down later, so a long video feels short. It still ends exactly at the end. No seeking; back 10 seconds is the one way back.
- **Resume:** returning viewers get "Continue watching (2:14)" or "Start over".
- **Timed CTA:** your button appears when the offer starts (`cta-at="6:11"`), inside the player and anywhere on the page you mark with `data-keepwatch-gate`.
- **A/B variants:** split traffic over several cuts; each viewer keeps theirs.
- **Smart pause and exit poster:** pause when the tab is hidden and play on when it returns (`smart-pause`); show an image behind the pause screen (`exit-poster`).
- **Analytics:** one row per viewing session (views, plays with sound, unmute rate, drop-off curve, CTA reached and clicked, finishes), sent to a collector you choose. No cookies, no IP, no personal data.
- English, Dutch and Russian built in; restyle with CSS custom properties.

## Build the embed

Three ways to the same embed code, all driven by one settings list (`src/config.ts`, reference in [SETTINGS.md](SETTINGS.md)):

- **Builder:** `bun run builder` opens a local page: paste a link, tune every setting with a live preview, copy the embed (script URL or fully inline), the config JSON or a React snippet, or download a test page. `dist/builder.html` is one self-contained file; YouTube needs it served over http, which `bun run builder` does.
- **Config file (for agents):** write a `keepwatch.config.json` (see `examples/clark-vsl.config.json`), then `bun run embed keepwatch.config.json` prints the embed. `--inline` puts the player inside the snippet, `--script <url>` points at your own copy, `--page out.html` writes a test page. A bad config prints every problem and exits 1.
- **Code:** `import { validateConfig, embedCode } from "keepwatch/server"`, or pass the same keys as props to `<Keepwatch />` in React.

What you can tune, following Vidalytics' own settings:

| Area | Settings |
|---|---|
| Autoplay | start mode, restart on unmute, preview loop, unmute copy (and a phone version), full screen on unmute |
| Controls | which buttons show, disable pausing, smart pause, default speed, speed menu |
| Progress bar | rapid (fast early, slow late), honest or hidden, rapid strength (and a phone strength) |
| Call to action | show at, hide at, text, link, new tab, exit CTA (on pause only), leave full screen for it, page gates |
| Pause & end | pause image, end screen / end image / loop / count down and redirect |
| Resume | ask, continue silently or always start over, and its copy |
| Video | thumbnail, language, expiry date and message |
| Look | accent, text on accent, progress colour, corner radius, aspect ratio |
| Analytics | collector URL, placement, video id; `keepwatch:progress` events at 25/50/75/90% |

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

`src` takes any of these:

| Provider | Link | What works |
|---|---|---|
| Vimeo | `https://vimeo.com/123456789`, unlisted with its hash (`/123456789/abcdef1234`) | everything |
| YouTube | `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/` | everything; played from youtube-nocookie.com |
| Plain file | any `.mp4`, `.webm`, `.mov`, `.m4v` URL, absolute or site-relative | everything |
| HLS | any `.m3u8` URL (Bunny Stream, Cloudflare Stream, Mux, S3) | everything; native in Safari and current Chrome, elsewhere add [hls.js](https://github.com/video-dev/hls.js) to the page |
| Loom | `loom.com/share/…` | poster, click to play in Loom's own player, view and play counts, timed CTA on the clock. Loom has no player API, so no muted preview, custom controls or watch time |

Vimeo's speed control needs a Vimeo plan that allows it; without one the speed menu hides itself.

### Attributes

| Attribute | What it does | Default |
|---|---|---|
| `src` | Video link (see above) | required (or `variants`) |
| `variants` | A/B: `[{"id":"long","src":"…","weight":1},{"id":"short","src":"…","weight":1}]` | |
| `video` | Analytics id for this video, e.g. `clark-vsl` | `<provider>-<id>` |
| `cta-at` | When the CTA appears: `6:11`, `371` | no timed CTA |
| `cta-href` | CTA target. `#id` scrolls on the page; a same-site link carries `utm_*` along | |
| `cta-text` | CTA label | "Book your call" per language |
| `cta-target` | `_blank` to open in a new tab | |
| `autoplay` | `load` (muted, at once), `inview` (muted, when half on screen), `click` (with sound, for modals opened by a click), `none` (poster + play button) | `load` |
| `collect` | Analytics endpoint. Leave out to send nothing | |
| `placement` | Where on the site it sits, for the dashboard: `main`, `hero`, `popup` | `main` |
| `poster` | Poster image | the provider's thumbnail |
| `lang` | `en`, `nl`, `ru` | the page's `<html lang>` |
| `label` | Accessible name of the video | "Video" |
| `bar-curve` | How far ahead the bar runs. `1` is honest | `2.2` |
| `speeds` | Speed menu, e.g. `1 1.25 1.5 2`; empty hides it | `0.75 1 1.25 1.5 2` |
| `preview-loop` | Loop the muted preview over its first seconds, e.g. `10` | the whole video |
| `unmute-title`, `unmute-text` | Unmute card copy | "Your video is playing", "Click to unmute" per language |
| `exit-poster` | Image behind the pause screen | the frozen frame |
| `smart-pause` | Boolean: pause while the tab is hidden, play on when it is back | off |

Reduced motion and Save-Data turn autoplay into a click-to-play poster.

### Styling

```css
keep-watch {
  --kw-accent: #2f6bff;   /* play button, unmute card, control pills */
  --kw-on-accent: #fff;   /* text and icons on the accent */
  --kw-chrome: rgba(47, 107, 255, .78); /* control pills (default: the accent, 78%) */
  --kw-bar: #fff;         /* progress fill */
  --kw-radius: 16px;
  --kw-font: inherit;
  --kw-aspect: 16 / 9;
}
keep-watch::part(cta) { /* the CTA button */ }
```

### Events

Every event bubbles out of the element with `detail: { video, variant, time }`:
`keepwatch:ready`, `keepwatch:play`, `keepwatch:unmute`, `keepwatch:pause`, `keepwatch:cta-shown`, `keepwatch:cta-click`, `keepwatch:ended`, `keepwatch:error`, and `keepwatch:progress` with `detail.percent` 25, 50, 75 and 90 (reached with sound on, once each per session).

```js
document.addEventListener("keepwatch:cta-click", (e) => fbq("track", "Lead", e.detail));
document.addEventListener("keepwatch:progress", (e) => dataLayer.push({ event: "vsl_progress", ...e.detail }));
```

### More providers

A provider mounts its own player inside Keepwatch's frame and drives it; Keepwatch keeps everything the viewer sees. Add one (Wistia, an in-house host) with `registerProvider` before the element renders:

```js
import { registerProvider } from "keepwatch";

registerProvider({
  id: "acme",
  controllable: true,
  parse: (input) => (/^acme:(\w+)$/.exec(input) ? { provider: "acme", id: RegExp.$1 } : null),
  mount(host, source, { muted, startAt, label }, on) {
    // Create the player in `host`, call on.ready / on.play / on.pause / on.ended / on.time / on.error,
    // and return { play, pause, seek, setMuted, isMuted, setRate, destroy }.
  },
});
```

The contract is `Provider` in `src/providers/types.ts`; the built-ins in `src/providers/` are the examples.

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

Build a collector with `keepwatch/server` (it also exports `parseSource` and `plainUrl`, for server-rendered fallback links):

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

`src/config.ts` is the settings list: every setting's key, attribute, default and help, which the builder form, `bun run embed`, the React props and SETTINGS.md are made from. Add a setting there first, then read its attribute in `src/element.ts` (a test fails if a listed attribute is never read). `src/core.ts` holds every rule as a pure, tested function; `src/sources.ts` recognises links; `src/providers/` holds one adapter per video host; `src/element.ts` is the player shell; `src/server.ts` is the collector contract. Change a rule in core, test it, then wire it. The demo has one player per provider.

Icons are [Lucide](https://lucide.dev) paths (ISC licence), inlined in `src/icons.ts`.

## Publish

```sh
npm version patch
npm publish
```

jsDelivr serves `https://cdn.jsdelivr.net/npm/keepwatch@0/dist/keepwatch.js` within minutes of a publish. Pin a major (`@0`) on sites so a breaking release never lands unannounced.
