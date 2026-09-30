/**
 * Every Keepwatch setting, in one list. The player reads these as element
 * attributes; this list is what the builder's form, the `embed` CLI, the
 * settings docs and config validation are made from. Add a setting here
 * first, then read its attribute in element.ts.
 *
 * A config is plain JSON (`keepwatch.config.json`), so an agent can write
 * one and `bun run embed` turns it into the embed code.
 */

import { parseTime } from "./core.ts";
import { parseSource } from "./sources.ts";

export type FieldType = "text" | "url" | "time" | "number" | "boolean" | "select" | "color" | "datetime" | "list";

export type Group = "Video" | "Autoplay" | "Controls" | "Progress bar" | "Call to action" | "Pause & end" | "Resume" | "Look" | "Analytics";

export const GROUPS: readonly Group[] = [
  "Video",
  "Autoplay",
  "Controls",
  "Progress bar",
  "Call to action",
  "Pause & end",
  "Resume",
  "Look",
  "Analytics",
];

type FieldDef = {
  key: string;
  group: Group;
  label: string;
  type: FieldType;
  /** The element attribute. Look fields set a CSS custom property instead (`css`). */
  attr?: string;
  css?: string;
  default?: string | number | boolean;
  options?: readonly { value: string; label: string }[];
  help: string;
  placeholder?: string;
};

const f = <const T extends FieldDef>(def: T) => def;

export const FIELDS = [
  // Video
  f({ key: "src", attr: "src", group: "Video", label: "Video link", type: "url", placeholder: "https://www.youtube.com/watch?v=…", help: "Vimeo, YouTube or Loom link, or an MP4/WebM/HLS URL." }),
  f({ key: "video", attr: "video", group: "Video", label: "Video id", type: "text", placeholder: "clark-vsl", help: "Analytics id. Keep it when you swap the file for a new cut of the same video." }),
  f({ key: "poster", attr: "poster", group: "Video", label: "Thumbnail", type: "url", help: "Image before the video starts. Default: the provider's thumbnail." }),
  f({ key: "label", attr: "label", group: "Video", label: "Accessible name", type: "text", default: "Video", help: "What screen readers call the video." }),
  f({ key: "lang", attr: "lang", group: "Video", label: "Language", type: "select", options: [{ value: "", label: "Page language" }, { value: "en", label: "English" }, { value: "nl", label: "Dutch" }, { value: "ru", label: "Russian" }], default: "", help: "Language of the built-in copy." }),
  f({ key: "expires", attr: "expires", group: "Video", label: "Expires at", type: "datetime", help: "After this moment the player shows the expiry message instead of the video." }),
  f({ key: "expiredText", attr: "expired-text", group: "Video", label: "Expiry message", type: "text", help: "Shown after `expires`. Default per language." }),

  // Autoplay
  f({ key: "autoplay", attr: "autoplay", group: "Autoplay", label: "Start", type: "select", default: "load", options: [{ value: "load", label: "Muted, on page load" }, { value: "inview", label: "Muted, when half on screen" }, { value: "click", label: "With sound, at once (after a click)" }, { value: "none", label: "Thumbnail and play button" }], help: "Muted autoplay is the only autoplay browsers allow; the unmute card turns it into a play." }),
  f({ key: "unmuteRestart", attr: "unmute-restart", group: "Autoplay", label: "Restart on unmute", type: "boolean", default: true, help: "Clicking the unmute card starts the video over from 0:00, so nobody hears the pitch from the middle." }),
  f({ key: "previewLoop", attr: "preview-loop", group: "Autoplay", label: "Loop preview after", type: "time", placeholder: "0:10", help: "Loop the muted preview over its first seconds. Empty: the whole video." }),
  f({ key: "unmuteTitle", attr: "unmute-title", group: "Autoplay", label: "Unmute headline", type: "text", placeholder: "Your video is playing", help: "Top line of the unmute card." }),
  f({ key: "unmuteText", attr: "unmute-text", group: "Autoplay", label: "Unmute line", type: "text", placeholder: "Click to unmute", help: "Second line of the unmute card." }),
  f({ key: "unmuteTitleMobile", attr: "unmute-title-mobile", group: "Autoplay", label: "Unmute headline, phones", type: "text", help: "Replaces the headline on touch screens." }),
  f({ key: "unmuteTextMobile", attr: "unmute-text-mobile", group: "Autoplay", label: "Unmute line, phones", type: "text", placeholder: "Tap to unmute", help: "Replaces the second line on touch screens." }),
  f({ key: "fullscreenOnUnmute", attr: "fullscreen-on-unmute", group: "Autoplay", label: "Full screen on unmute", type: "select", default: "", options: [{ value: "", label: "Never" }, { value: "mobile", label: "Phones" }, { value: "desktop", label: "Desktop" }, { value: "always", label: "Always" }], help: "Go full screen when the viewer turns the sound on." }),

  // Controls
  f({ key: "controls", attr: "controls", group: "Controls", label: "Buttons", type: "list", default: "play rewind sound time speed fullscreen", options: [{ value: "play", label: "Play/pause" }, { value: "rewind", label: "Back 10s" }, { value: "sound", label: "Sound" }, { value: "time", label: "Time" }, { value: "speed", label: "Speed" }, { value: "fullscreen", label: "Full screen" }], help: "Which buttons the control bar shows." }),
  f({ key: "noPause", attr: "no-pause", group: "Controls", label: "Disable pausing", type: "boolean", default: false, help: "No pause button and no click-to-pause. Keeps viewers in the pitch; use with care." }),
  f({ key: "smartPause", attr: "smart-pause", group: "Controls", label: "Smart pause", type: "boolean", default: false, help: "Pause while the tab is hidden, play on when it comes back." }),
  f({ key: "speed", attr: "speed", group: "Controls", label: "Default speed", type: "number", default: 1, help: "Playback speed at the start, e.g. 1.1. Vimeo needs a plan that allows speed." }),
  f({ key: "speeds", attr: "speeds", group: "Controls", label: "Speed menu", type: "text", default: "0.75 1 1.25 1.5 2", help: "Speeds offered in the menu, space-separated. Empty hides the menu." }),

  // Progress bar
  f({ key: "bar", attr: "bar", group: "Progress bar", label: "Style", type: "select", default: "rapid", options: [{ value: "rapid", label: "Rapid: fast early, slow late" }, { value: "linear", label: "Honest" }, { value: "none", label: "Hidden" }], help: "Rapid makes a long video feel short and still ends exactly at the end. Never seekable." }),
  f({ key: "barCurve", attr: "bar-curve", group: "Progress bar", label: "Rapid strength", type: "number", default: 2.2, help: "How far ahead the rapid bar runs. 1 is honest; 2.2 shows half the bar at 27% of the video." }),
  f({ key: "barCurveMobile", attr: "bar-curve-mobile", group: "Progress bar", label: "Rapid strength, phones", type: "number", help: "A different strength on touch screens. Empty: the same." }),

  // Call to action
  f({ key: "ctaAt", attr: "cta-at", group: "Call to action", label: "Show at", type: "time", placeholder: "6:11", help: "When the button appears (the offer). Also unlocks `data-keepwatch-gate` sections on the page." }),
  f({ key: "ctaUntil", attr: "cta-until", group: "Call to action", label: "Hide at", type: "time", help: "When the in-player button goes again. Empty: until the end." }),
  f({ key: "ctaText", attr: "cta-text", group: "Call to action", label: "Button text", type: "text", placeholder: "Book your call", help: "Default per language." }),
  f({ key: "ctaHref", attr: "cta-href", group: "Call to action", label: "Button link", type: "url", placeholder: "#book", help: "`#id` scrolls to a section; a same-site link carries the page's utm_* along." }),
  f({ key: "ctaTarget", attr: "cta-target", group: "Call to action", label: "Open in", type: "select", default: "", options: [{ value: "", label: "Same tab" }, { value: "_blank", label: "New tab" }], help: "" }),
  f({ key: "ctaMode", attr: "cta-mode", group: "Call to action", label: "Show while", type: "select", default: "timed", options: [{ value: "timed", label: "Playing, from 'Show at'" }, { value: "pause", label: "Paused only (exit CTA)" }], help: "An exit CTA only appears when the viewer pauses." }),
  f({ key: "ctaExitFullscreen", attr: "cta-exit-fullscreen", group: "Call to action", label: "Leave full screen for the CTA", type: "boolean", default: false, help: "When the button appears, drop out of full screen so the page's offer is in view." }),

  // Pause & end
  f({ key: "exitPoster", attr: "exit-poster", group: "Pause & end", label: "Pause image", type: "url", help: "Shown behind the pause screen instead of the frozen frame." }),
  f({ key: "end", attr: "end", group: "Pause & end", label: "At the end", type: "select", default: "panel", options: [{ value: "panel", label: "CTA and Watch again" }, { value: "poster", label: "End image with CTA" }, { value: "loop", label: "Loop" }, { value: "redirect", label: "Count down, then redirect" }], help: "What happens when the video finishes." }),
  f({ key: "endPoster", attr: "end-poster", group: "Pause & end", label: "End image", type: "url", help: "For 'End image with CTA'." }),
  f({ key: "endRedirect", attr: "end-redirect", group: "Pause & end", label: "Redirect to", type: "url", help: "For 'redirect'. A same-site link carries utm_* along." }),
  f({ key: "endCountdown", attr: "end-countdown", group: "Pause & end", label: "Countdown seconds", type: "number", default: 5, help: "Seconds before the redirect." }),
  f({ key: "endText", attr: "end-text", group: "Pause & end", label: "Countdown message", type: "text", placeholder: "Taking you to the next step in {s}…", help: "`{s}` is the seconds left." }),

  // Resume
  f({ key: "resume", attr: "resume", group: "Resume", label: "Returning viewers", type: "select", default: "ask", options: [{ value: "ask", label: "Ask: continue or start over" }, { value: "auto", label: "Continue without asking" }, { value: "off", label: "Always from the start" }], help: "Where a returning viewer starts." }),
  f({ key: "resumeTitle", attr: "resume-title", group: "Resume", label: "Question", type: "text", placeholder: "You already started this video", help: "" }),
  f({ key: "resumeContinue", attr: "resume-continue", group: "Resume", label: "Continue button", type: "text", placeholder: "Continue watching", help: "The time is added after it." }),
  f({ key: "resumeRestart", attr: "resume-restart", group: "Resume", label: "Restart button", type: "text", placeholder: "Start over", help: "" }),

  // Look
  f({ key: "accent", css: "--kw-accent", group: "Look", label: "Accent", type: "color", default: "#2f6bff", help: "Play button, unmute card, control pills." }),
  f({ key: "onAccent", css: "--kw-on-accent", group: "Look", label: "Text on accent", type: "color", default: "#ffffff", help: "" }),
  f({ key: "barColor", css: "--kw-bar", group: "Look", label: "Progress fill", type: "color", default: "#ffffff", help: "" }),
  f({ key: "radius", css: "--kw-radius", group: "Look", label: "Corner radius", type: "text", default: "16px", help: "e.g. 0, 12px, 24px." }),
  f({ key: "aspect", css: "--kw-aspect", group: "Look", label: "Aspect ratio", type: "select", default: "16 / 9", options: [{ value: "16 / 9", label: "16:9" }, { value: "9 / 16", label: "9:16 (vertical)" }, { value: "4 / 5", label: "4:5" }, { value: "1 / 1", label: "1:1" }, { value: "4 / 3", label: "4:3" }], help: "" }),

  // Analytics
  f({ key: "collect", attr: "collect", group: "Analytics", label: "Collector URL", type: "url", placeholder: "https://getclark.app/api/vsl", help: "Where watch data goes. Empty sends nothing. The collector must allow this site." }),
  f({ key: "placement", attr: "placement", group: "Analytics", label: "Placement", type: "text", default: "main", help: "Where on the site the player sits, for the dashboard: main, hero, popup." }),
] as const;

export type Field = (typeof FIELDS)[number];
export type FieldKey = Field["key"];
export type VariantInput = { id?: string; src: string; weight?: number };
export type KeepwatchConfig = Partial<Record<FieldKey, string | number | boolean>> & { variants?: VariantInput[] };

export function fieldByKey(key: string): Field | undefined {
  return FIELDS.find((x) => x.key === key);
}

function isDefault(field: Field, value: string | number | boolean): boolean {
  return "default" in field && field.default === value;
}

/** Attributes and inline style for a config. Defaults are left out, so the embed stays short. */
export function configToAttributes(config: KeepwatchConfig): { attrs: [string, string][]; style: string } {
  const attrs: [string, string][] = [];
  const style: string[] = [];
  for (const field of FIELDS) {
    const value = config[field.key];
    if (value === undefined || value === "" || isDefault(field, value)) continue;
    if ("css" in field && field.css) {
      style.push(`${field.css}: ${value}`);
      continue;
    }
    if (!("attr" in field) || !field.attr) continue;
    if (field.type === "boolean") {
      // A true default is switched off with "false"; a false default is switched on by presence.
      if (value === true) attrs.push([field.attr, ""]);
      else attrs.push([field.attr, "false"]);
    } else attrs.push([field.attr, String(value)]);
  }
  if (config.variants?.length) {
    const src = attrs.findIndex(([name]) => name === "src");
    if (src >= 0) attrs.splice(src, 1);
    attrs.unshift(["variants", JSON.stringify(config.variants)]);
  }
  return { attrs, style: style.join("; ") };
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The `<keep-watch>` tag for a config. */
export function elementHtml(config: KeepwatchConfig): string {
  const { attrs, style } = configToAttributes(config);
  const parts = attrs.map(([name, value]) => (value === "" ? name : `${name}="${escapeAttr(value)}"`));
  if (style) parts.push(`style="${escapeAttr(style)}"`);
  return parts.length ? `<keep-watch\n  ${parts.join("\n  ")}\n></keep-watch>` : "<keep-watch></keep-watch>";
}

/**
 * Make code safe inside an inline <script>. `</script` ends the element, and
 * `<!--` with `<script` switch the HTML parser into its escaped states, which
 * move where the script ends. `\x3C` means "<" in JS strings, template
 * literals and regexes alike, and the HTML parser does not see it.
 */
export function scriptSafe(code: string): string {
  return code.replace(/<(?=!--|\/?script)/gi, "\\x3C");
}

export const CDN_SCRIPT = "https://cdn.jsdelivr.net/npm/keepwatch@0/dist/keepwatch.js";

/**
 * The full embed: the script (a URL, or the player's own code inline so the
 * snippet needs nothing else), the element, and a gate example when the CTA
 * points at a section on the page.
 */
export function embedCode(config: KeepwatchConfig, script: { src: string } | { inline: string } = { src: CDN_SCRIPT }): string {
  const tag = "src" in script ? `<script src="${escapeAttr(script.src)}" defer></script>` : `<script>${scriptSafe(script.inline)}</script>`;
  const out = [tag, "", elementHtml(config)];
  const href = typeof config.ctaHref === "string" ? config.ctaHref : "";
  if (href.startsWith("#") && href.length > 1) {
    out.push(
      "",
      `<!-- Hidden until the video reaches ${config.ctaAt ?? "the CTA time"} (or cannot load). -->`,
      `<section id="${escapeAttr(href.slice(1))}" data-keepwatch-gate>`,
      "  …your booking section…",
      "</section>",
    );
  }
  return out.join("\n");
}

export type ConfigIssue = { key: string; message: string };

/**
 * Check a config from JSON. Unknown keys, wrong types, unknown options,
 * unreadable times and unsupported links are reported, never thrown, so the
 * builder and the CLI can show every problem at once.
 */
export function validateConfig(raw: unknown): { config: KeepwatchConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const config: KeepwatchConfig = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { config, issues: [{ key: "", message: "A config is a JSON object." }] };
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "$schema") continue;
    if (key === "variants") {
      if (!Array.isArray(value)) {
        issues.push({ key, message: "variants is a list of { id, src, weight }." });
        continue;
      }
      const list: VariantInput[] = [];
      value.forEach((v, i) => {
        const item = v as Record<string, unknown>;
        if (!item || typeof item.src !== "string" || !parseSource(item.src)) {
          issues.push({ key: `variants[${i}]`, message: "needs a supported `src` link." });
          return;
        }
        list.push({
          src: item.src,
          ...(typeof item.id === "string" ? { id: item.id } : {}),
          ...(typeof item.weight === "number" ? { weight: item.weight } : {}),
        });
      });
      config.variants = list;
      continue;
    }
    const field = fieldByKey(key);
    if (!field) {
      issues.push({ key, message: "is not a Keepwatch setting." });
      continue;
    }
    const want = field.type === "boolean" ? "boolean" : field.type === "number" ? "number" : "string";
    if (typeof value !== want) {
      issues.push({ key, message: `should be a ${want}.` });
      continue;
    }
    if (field.type === "select" && "options" in field && !field.options.some((o) => o.value === value)) {
      issues.push({ key, message: `should be one of: ${field.options.map((o) => o.value || '""').join(", ")}.` });
      continue;
    }
    if (field.type === "list" && "options" in field) {
      const bad = String(value).split(/\s+/).filter((v) => v && !field.options.some((o) => o.value === v));
      if (bad.length) issues.push({ key, message: `unknown: ${bad.join(", ")}.` });
    }
    if (field.type === "time" && value !== "" && parseTime(String(value)) === null) {
      issues.push({ key, message: 'is not a time like "6:11" or "371".' });
      continue;
    }
    if (key === "src" && value !== "" && !parseSource(String(value))) {
      issues.push({ key, message: "is not a Vimeo, YouTube or Loom link, or a video file URL." });
      continue;
    }
    config[key as FieldKey] = value as string | number | boolean;
  }
  if (!config.src && !config.variants?.length && !issues.some((i) => i.key === "src")) issues.push({ key: "src", message: "A video link (src) is required." });
  return { config, issues };
}

/** The settings as a Markdown reference, generated so it never drifts from the player. */
export function settingsMarkdown(): string {
  const lines = ["# Keepwatch settings", "", "Generated from `src/config.ts`. Config key → element attribute (or CSS property) → default.", ""];
  for (const group of GROUPS) {
    lines.push(`## ${group}`, "", "| Key | Attribute | Default | What it does |", "|---|---|---|---|");
    for (const field of FIELDS.filter((x) => x.group === group)) {
      const where = "css" in field && field.css ? `\`${field.css}\`` : `\`${"attr" in field ? field.attr : ""}\``;
      const def = "default" in field && field.default !== "" ? `\`${String(field.default)}\`` : "";
      const opts = "options" in field ? ` Options: ${field.options.map((o) => `\`${o.value || '""'}\``).join(", ")}.` : "";
      lines.push(`| \`${field.key}\` | ${where} | ${def} | ${field.label}. ${field.help}${opts} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
