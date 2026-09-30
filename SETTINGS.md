# Keepwatch settings

Generated from `src/config.ts`. Config key → element attribute (or CSS property) → default.

## Video

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `src` | `src` |  | Video link. Vimeo, YouTube or Loom link, or an MP4/WebM/HLS URL. |
| `video` | `video` |  | Video id. Analytics id. Keep it when you swap the file for a new cut of the same video. |
| `poster` | `poster` |  | Thumbnail. Image before the video starts. Default: the provider's thumbnail. |
| `label` | `label` | `Video` | Accessible name. What screen readers call the video. |
| `lang` | `lang` |  | Language. Language of the built-in copy. Options: `""`, `en`, `nl`, `ru`. |
| `expires` | `expires` |  | Expires at. After this moment the player shows the expiry message instead of the video. |
| `expiredText` | `expired-text` |  | Expiry message. Shown after `expires`. Default per language. |

## Autoplay

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `autoplay` | `autoplay` | `load` | Start. Muted autoplay is the only autoplay browsers allow; the unmute card turns it into a play. Options: `load`, `inview`, `click`, `none`. |
| `unmuteRestart` | `unmute-restart` | `true` | Restart on unmute. Clicking the unmute card starts the video over from 0:00, so nobody hears the pitch from the middle. |
| `previewLoop` | `preview-loop` |  | Loop preview after. Loop the muted preview over its first seconds. Empty: the whole video. |
| `unmuteTitle` | `unmute-title` |  | Unmute headline. Top line of the unmute card. |
| `unmuteText` | `unmute-text` |  | Unmute line. Second line of the unmute card. |
| `unmuteTitleMobile` | `unmute-title-mobile` |  | Unmute headline, phones. Replaces the headline on touch screens. |
| `unmuteTextMobile` | `unmute-text-mobile` |  | Unmute line, phones. Replaces the second line on touch screens. |
| `fullscreenOnUnmute` | `fullscreen-on-unmute` |  | Full screen on unmute. Go full screen when the viewer turns the sound on. Options: `""`, `mobile`, `desktop`, `always`. |

## Controls

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `controls` | `controls` | `play rewind sound time speed fullscreen` | Buttons. Which buttons the control bar shows. Options: `play`, `rewind`, `sound`, `time`, `speed`, `fullscreen`. |
| `noPause` | `no-pause` | `false` | Disable pausing. No pause button and no click-to-pause. Keeps viewers in the pitch; use with care. |
| `smartPause` | `smart-pause` | `false` | Smart pause. Pause while the tab is hidden, play on when it comes back. |
| `speed` | `speed` | `1` | Default speed. Playback speed at the start, e.g. 1.1. Vimeo needs a plan that allows speed. |
| `speeds` | `speeds` | `0.75 1 1.25 1.5 2` | Speed menu. Speeds offered in the menu, space-separated. Empty hides the menu. |

## Progress bar

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `bar` | `bar` | `rapid` | Style. Rapid makes a long video feel short and still ends exactly at the end. Never seekable. Options: `rapid`, `linear`, `none`. |
| `barCurve` | `bar-curve` | `2.2` | Rapid strength. How far ahead the rapid bar runs. 1 is honest; 2.2 shows half the bar at 27% of the video. |
| `barCurveMobile` | `bar-curve-mobile` |  | Rapid strength, phones. A different strength on touch screens. Empty: the same. |

## Call to action

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `ctaAt` | `cta-at` |  | Show at. When the button appears (the offer). Also unlocks `data-keepwatch-gate` sections on the page. |
| `ctaUntil` | `cta-until` |  | Hide at. When the in-player button goes again. Empty: until the end. |
| `ctaText` | `cta-text` |  | Button text. Default per language. |
| `ctaHref` | `cta-href` |  | Button link. `#id` scrolls to a section; a same-site link carries the page's utm_* along. |
| `ctaTarget` | `cta-target` |  | Open in.  Options: `""`, `_blank`. |
| `ctaMode` | `cta-mode` | `timed` | Show while. An exit CTA only appears when the viewer pauses. Options: `timed`, `pause`. |
| `ctaExitFullscreen` | `cta-exit-fullscreen` | `false` | Leave full screen for the CTA. When the button appears, drop out of full screen so the page's offer is in view. |

## Pause & end

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `exitPoster` | `exit-poster` |  | Pause image. Shown behind the pause screen instead of the frozen frame. |
| `end` | `end` | `panel` | At the end. What happens when the video finishes. Options: `panel`, `poster`, `loop`, `redirect`. |
| `endPoster` | `end-poster` |  | End image. For 'End image with CTA'. |
| `endRedirect` | `end-redirect` |  | Redirect to. For 'redirect'. A same-site link carries utm_* along. |
| `endCountdown` | `end-countdown` | `5` | Countdown seconds. Seconds before the redirect. |
| `endText` | `end-text` |  | Countdown message. `{s}` is the seconds left. |

## Resume

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `resume` | `resume` | `ask` | Returning viewers. Where a returning viewer starts. Options: `ask`, `auto`, `off`. |
| `resumeTitle` | `resume-title` |  | Question.  |
| `resumeContinue` | `resume-continue` |  | Continue button. The time is added after it. |
| `resumeRestart` | `resume-restart` |  | Restart button.  |

## Look

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `accent` | `--kw-accent` | `#2f6bff` | Accent. Play button, unmute card, control pills. |
| `onAccent` | `--kw-on-accent` | `#ffffff` | Text on accent.  |
| `barColor` | `--kw-bar` | `#ffffff` | Progress fill.  |
| `radius` | `--kw-radius` | `16px` | Corner radius. e.g. 0, 12px, 24px. |
| `aspect` | `--kw-aspect` | `16 / 9` | Aspect ratio.  Options: `16 / 9`, `9 / 16`, `4 / 5`, `1 / 1`, `4 / 3`. |

## Analytics

| Key | Attribute | Default | What it does |
|---|---|---|---|
| `collect` | `collect` |  | Collector URL. Where watch data goes. Empty sends nothing. The collector must allow this site. |
| `placement` | `placement` | `main` | Placement. Where on the site the player sits, for the dashboard: main, hero, popup. |
