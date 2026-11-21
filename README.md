# Keepwatch

A VSL player for Vimeo, YouTube, Loom and plain video files (MP4, WebM, HLS), plus the watch analytics behind it. One script tag, one HTML tag, and it works on any site: plain HTML, Webflow, WordPress, GoHighLevel, Next.js.

- **Muted autoplay:** starts muted behind a "This video has sound / Click to unmute" card, with no controls and no progress bar, so the preview never looks like minutes already missed. The click restarts the video from 0:00 with sound, so nobody hears the pitch from the middle. Optionally loops the first seconds (`preview-loop`).
- **Player chrome:** play/pause, back 10 seconds, sound, an elapsed-time counter, a speed menu and full screen, in pill groups that fade out while the video plays. Lucide icons, no emoji.
- **Fast progress bar:** runs ahead early and slows down later, so a long video feels short. It still ends exactly at the end. It is a display: no seeking, back 10 seconds is the one way back.
- **Honest, seekable bar:** `bar="linear"` shows the real position and is a slider: drag it, tap it, or use the arrow keys, Page Up/Down, Home and End.
- **Chapters:** `chapters="0:00 Intro|1:20 Demo|2:40 Offer"` (or a WebVTT file) puts marks on the bar, shows the current chapter next to the time and adds a chapter list to jump from.
- **Captions:** a WebVTT file per language, drawn by the player itself, so they work over Vimeo and YouTube as well as over a file. A captions button; the viewer's choice is remembered.
- **Mini player:** `mini="bottom-right"` keeps a playing video in a corner when the viewer scrolls past it. The page keeps the player's space, so nothing jumps.
- **Resume:** returning viewers get "Continue watching (2:14)" or "Start over".
- **Timed CTA:** your button appears when the offer starts (`cta-at="6:11"`), inside the player and anywhere on the page you mark with `data-keepwatch-gate`.
- **A/B variants:** split traffic over several cuts; each viewer keeps theirs.
- **Pause when hidden and exit poster:** pause when the tab is hidden and play on when it returns (`smart-pause`); show an image behind the pause screen (`exit-poster`).
- **Analytics:** one row per viewing session (views, plays with sound, unmute rate, drop-off curve, CTA reached and clicked, finishes), sent to a collector you choose. No cookies, no IP, no personal data.
- English, Dutch and Russian built in; restyle with CSS custom properties.

## Build the embed

Three ways to the same embed code, all driven by one settings list (`src/config.ts`, reference in [SETTINGS.md](SETTINGS.md)):

- **Builder:** `bun run builder` opens a local page: paste a link, tune every setting with a live preview, copy the embed (script URL or fully inline), the config JSON or a React snippet, or download a test page. `dist/builder.html` is one self-contained file; YouTube needs it served over http, which `bun run builder` does.
- **Config file (for agents):** write a `keepwatch.config.json` (see `examples/clark-vsl.config.json`), then `bun run embed keepwatch.config.json` prints the embed. `--inline` puts the player inside the snippet, `--script <url>` points at your own copy, `--page out.html` writes a test page. A bad config prints every problem and exits 1.
- **Code:** `import { validateConfig, embedCode } from "keepwatch/server"`, or pass the same keys as props to `<Keepwatch />` in React.

What you can tune:

| Area | Settings |
|---|---|
| Autoplay | start mode, restart on unmute, preview loop, unmute copy (and a phone version), full screen on unmute |
| Controls | which buttons show, disable pausing, smart pause, default speed, speed menu |
| Progress bar | rapid (fast early, slow late), honest and seekable, or hidden; rapid strength (and a phone strength) |
| Chapters & captions | chapters (a list or a WebVTT file), captions file(s), captions language, captions on at the start |
| Mini player | which corner, width, float only while playing or also paused, close button |
| Call to action | show at, hide at, text, link, new tab, exit CTA (on pause only), leave full screen for it, page gates |
| Pause & end | pause image, end screen / end image / loop / count down and redirect |
| Resume | ask, continue silently or always start over, and its copy |
| Video | thumbnail, language, expiry date and message |
| Look | accent, text on accent, progress colour, corner radius, aspect ratio |
| Analytics | collector URL, placement, video id; `keepwatch:progress` events at 25/50/75/90% |

## Drop it on any page

```html
<script src="https://getclark.app/keepwatch.js" defer></script>

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
| `unmute-title`, `unmute-text` | Unmute card copy | "This video has sound", "Click to unmute" per language |
| `exit-poster` | Image behind the pause screen | the frozen frame |
| `smart-pause` | Boolean: pause while the tab is hidden, play on when it is back | off |
| `bar` | `rapid` (a display that runs ahead), `linear` (the real position, seekable), `none` | `rapid` |
| `seek` | `false` keeps a `linear` bar a display. The rapid bar never seeks | on for `linear` |
| `chapters` | `0:00 Intro\|1:20 Demo\|2:40 Offer`, or the URL of a WebVTT chapters file | none |
| `captions` | URL of a WebVTT file, or several: `en=/c/en.vtt nl=/c/nl.vtt` | none |
| `captions-lang` | Language of the captions file; with several, the one to start with | |
| `captions-on` | Boolean: show captions before the viewer has chosen | off |
| `mini` | `bottom-right`, `bottom-left`, `top-right`, `top-left`: float there when scrolled out of view | off |
| `mini-width` | Width of the floating player in pixels, 160 to 640 | `320` |
| `mini-when` | `playing` (only a video playing with sound floats) or `always` (also the muted preview and a paused video) | `playing` |
| `mini-close` | `false` removes the close button | on |

Reduced motion and Save-Data turn autoplay into a click-to-play poster.

### Chapters and the seekable bar

```html
<keep-watch src="/video/demo.mp4" bar="linear" chapters="0:00 Intro|1:20 Demo|2:40 Offer"></keep-watch>
<keep-watch src="https://vimeo.com/1226915932" chapters="/video/chapters.vtt"></keep-watch>
```

- A list is entries split by `|` (or new lines), each a time (`1:20`, `1:02:03`, `80`) and a title. A value without a space or `|` is read as the URL of a WebVTT file, where each cue is a chapter and its first line the title.
- Entries that cannot be read are skipped, the rest are sorted, and chapters that start after the video ends are ignored. A broken list or a file that fails to load never stops the video.
- The viewer gets a mark on the bar per chapter, the current title next to the time (in the bar's tooltip and its screen reader text too), and a chapter button that opens the list. The list works with a pointer, a finger and the keyboard (Tab, Enter, Escape).
- Marks sit where the bar puts that time. On the default rapid bar that is on the curve, so the fill reaches a mark exactly when the chapter starts.
- **Seeking is a property of the linear bar.** `bar="linear"` makes the bar a slider (`role="slider"`, value in seconds): click or drag with a pointer, drag with a finger, or focus it and use Left/Right (5 seconds), Page Up/Down (a tenth of the video), Home and End. `seek="false"` turns that off and keeps the bar a display. The rapid bar never seeks, because a place on a rapid bar is not that place in the video. The chapter list jumps on either bar.
- A jump is not watching: the seconds skipped are not counted as watched. The furthest point reached does move with a forward jump, so the timed CTA appears for a viewer who seeks past `cta-at`.

### Captions

```html
<keep-watch src="https://www.youtube.com/watch?v=…" captions="/captions/en.vtt" captions-lang="en"></keep-watch>
<keep-watch src="/video/demo.mp4" captions="en=/captions/en.vtt nl=/captions/nl.vtt" captions-lang="nl" captions-on></keep-watch>
```

- One file: the captions button is an on/off switch. Several (`lang=url`, separated by spaces): the button opens a list with Off and each language, named in the player's language.
- Captions are off until the viewer turns them on, unless the page sets `captions-on`. What the viewer chose (off, or a language) is kept in localStorage for every Keepwatch video on the site and wins over the page's default.
- The player fetches and parses the file itself and shows cues by its own clock, in its own overlay. That is why captions work the same over a Vimeo or YouTube iframe as over a file. Loom has no clock to follow, so no captions there.
- Only timings and text are used. `NOTE`, `STYLE` and `REGION` blocks, cue settings and cue tags (`<b>`, `<v Name>`, timestamps) are dropped, and cue text is put on the page as text, never as HTML.
- A file on another origin must allow the request (CORS). A file that fails to load logs one console error; the video plays on.

### Mini player

```html
<keep-watch src="…" mini="bottom-right" mini-width="320"></keep-watch>
```

- When the player is scrolled out of view while it plays with sound, it floats in the chosen corner. Scrolling back returns it; so does the close button, which keeps it in place for the rest of the page view. An arrow button scrolls the page back to the video.
- The `<keep-watch>` element stays where it is, with the same box, and shows a note (over the dimmed poster, when there is one) while the player floats: the page does not jump. The video is the same player, moved by CSS only, so it never restarts and never plays twice.
- `mini-when="always"` also floats the muted preview and a video that was paused in the page. With the default, a video paused inside the mini player stays there, so the play button does not disappear.
- Phones get at most 60% of the screen width; a vertical video is never taller than half the window. The floating player shows play, sound and full screen; full screen brings the player home first.
- Where the browser has the Popover API (current Chrome, Safari and Firefox) the floating player is in the top layer, so no `overflow`, `transform` or `z-index` on the page can clip or cover it. It also sits above the page's own dialogs. Elsewhere it is `position: fixed` with `--kw-mini-z`.
- `prefers-reduced-motion` drops the slide-in. The element has `data-mini="<corner>"` while it floats, for page CSS.

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
  --kw-captions-size: 20px;              /* default scales with the player */
  --kw-captions-color: #fff;
  --kw-captions-bg: rgba(0, 0, 0, .78);
  --kw-mini-x: 16px;      /* the mini player's distance from the side of the window */
  --kw-mini-y: 16px;      /* and from the top or bottom, e.g. to clear a chat button */
  --kw-mini-radius: 12px;
  --kw-mini-z: 2147483000; /* only where the browser has no top layer */
}
keep-watch::part(cta) { /* the CTA button */ }
keep-watch::part(captions) { /* the captions overlay */ }
```

### Events

Every event bubbles out of the element with `detail: { video, variant, time }`:
`keepwatch:ready`, `keepwatch:play`, `keepwatch:unmute`, `keepwatch:pause`, `keepwatch:cta-shown`, `keepwatch:cta-click`, `keepwatch:ended`, `keepwatch:error`, and `keepwatch:progress` with `detail.percent` 25, 50, 75 and 90 (reached with sound on, once each per session).

Four more events describe the viewer's use of the player. They are DOM events only; nothing new is sent to the collector:

| Event | Extra `detail` | When |
|---|---|---|
| `keepwatch:chapter` | `index`, `title`, `start` | the chapter under the clock changed (playing on, or a jump) |
| `keepwatch:seek` | `from`, `to` (seconds) | the viewer moved through the video with the bar or the chapter list |
| `keepwatch:captions` | `on`, `lang` | the viewer turned captions on, off, or picked a language |
| `keepwatch:mini` | `floating` | the player started or stopped floating |

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

### Conversions and revenue

Every beat carries an anonymous `viewer` id (random, first-party localStorage, no cookie, no IP) and a `returning` flag, so a dashboard can count unique and returning viewers. On the thank-you page, report the sale; Keepwatch credits it to the viewer and to the last video and variant they watched:

```html
<script src="https://getclark.app/keepwatch.js"></script>
<script>keepwatch.convert({ value: 497, currency: "EUR", id: "order-1042" });</script>
<!-- or, as markup: -->
<keep-watch-convert value="497" currency="EUR" order-id="order-1042"></keep-watch-convert>
```

It goes to the same `collect` endpoint as the beats, with `kind: "conversion"`. The order id is hashed (SHA-256) in the browser and never sent as is. A collector validates it with `parseConversion`, stores it once per `conversionKey` (the order hash per site) and caps it per viewer.

A conversion is **reported by the browser and unverified**, like any pixel: anyone who can reach the collector can send one. Show it as such. Trustworthy revenue needs a server-to-server postback signed with a per-site secret, which is not built yet.

Every field, type and trigger is in [docs/EVENTS.md](docs/EVENTS.md).

The reference collector and dashboard live in getclark.app (`/api/vsl`, `/admin/vsl-analytics`). To report from a new site, add its hostname to the allowlist there.

## Develop

```sh
bun install
bun test          # core rules
bun run build     # dist/keepwatch.js (CDN), dist/index.js, dist/server.js, dist/react.js + types
bunx serve .      # then open /demo
```

`src/config.ts` is the settings list: every setting's key, attribute, default and help, which the builder form, `bun run embed`, the React props and SETTINGS.md are made from. Add a setting there first, then read its attribute in `src/element.ts` (a test fails if a listed attribute is never read). `src/core.ts` holds every rule as a pure, tested function, with `src/bar.ts` (bar and seek maths), `src/chapters.ts`, `src/vtt.ts` (the WebVTT parser) and `src/mini.ts` (when the player floats) beside it; `src/ui/` holds the parts that wire those to the DOM (the rail, the captions overlay, the floating frame); `src/sources.ts` recognises links; `src/providers/` holds one adapter per video host; `src/element.ts` is the player shell; `src/server.ts` is the collector contract. Change a rule in core, test it, then wire it. The demo has one player per provider; `demo/features.html` shows chapters, seeking, captions and the mini player.

Icons are [Lucide](https://lucide.dev) paths (ISC licence), inlined in `src/icons.ts`.

## Publish

```sh
npm version patch
npm publish
```

Sites load the player from `https://getclark.app/keepwatch.js`, which getclark.app copies from the Keepwatch version it vendors on every build: a release reaches every site when getclark.app moves to it. Once the package is on npm, jsDelivr also serves `https://cdn.jsdelivr.net/npm/keepwatch@0/dist/keepwatch.js`.
