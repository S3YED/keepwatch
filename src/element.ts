import { barMode, barPosition, canSeek, clampSeek } from "./bar.ts";
import { chapterAt, chapterMarks, chaptersFromCues, chaptersInput, fitChapters, type Chapter } from "./chapters.ts";
import {
  clock,
  ctaVisible,
  mmss,
  parseTime,
  pickVariant,
  readUtm,
  resumeFrom,
  slug,
  BAR_CURVE,
  type Beat,
  type Variant,
} from "./core.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { icon, type IconName } from "./icons.ts";
import { providerFor, resolveSource } from "./providers/index.ts";
import type { MediaHandle, Provider } from "./providers/types.ts";
import { plainUrl, providerName, sourceKey } from "./sources.ts";
import { miniCorner, miniWhen, shouldFloat, type Corner } from "./mini.ts";
import { claimAudio, installGateStyle, load, loadPrefs, onAudioClaimed, save, savePrefs, unlockGates } from "./store.ts";
import { CSS } from "./styles.ts";
import { CaptionsView } from "./ui/captions.ts";
import { el, fetchText, reducedMotion } from "./ui/dom.ts";
import { Floater } from "./ui/floating.ts";
import { Rail } from "./ui/rail.ts";
import { parseCaptionTracks, parseVtt, pickCaptionTrack, type CaptionTrack } from "./vtt.ts";

/**
 * <keep-watch>: a VSL player over Vimeo, YouTube, Loom or a
 * video file.
 *
 *   <keep-watch src="https://vimeo.com/1226915932" cta-at="6:11"
 *               cta-href="#book" collect="https://getclark.app/api/vsl"></keep-watch>
 *
 * Every attribute is listed, with defaults, in SETTINGS.md (generated from
 * src/config.ts). The common ones:
 *
 * Attributes
 *   src         Vimeo, YouTube or Loom link, or an MP4/WebM/HLS URL.
 *   variants    A/B instead of src: JSON [{"id":"a","src":"…","weight":1}, …].
 *   video       Analytics id for this video. Default: the first variant's id.
 *   cta-at      When the CTA appears ("6:11", "371"). Omit for no timed CTA.
 *   cta-href    Where the CTA goes. "#id" scrolls; anything else navigates, carrying utm_*.
 *   cta-text    CTA label. Default per language ("Book your call").
 *   cta-target  "_blank" to open the CTA in a new tab.
 *   autoplay    "load" (default): muted autoplay at once. "inview": when half on screen.
 *               "click": with sound at once (use after a click, e.g. in a modal).
 *               "none": poster and play button only.
 *   collect     Analytics endpoint. Omit to send nothing.
 *   placement   Where the player sits on the site, for the dashboard. Default "main".
 *   poster      Poster image URL. Default: the provider's thumbnail.
 *   lang        en | nl | ru. Default: the page's <html lang>.
 *   label       Accessible name of the video. Default "Video".
 *   bar-curve   How far ahead the bar runs. 1 is honest, 2.2 default, higher is faster early.
 *   speeds      Speeds in the settings menu, e.g. "1 1.25 1.5 2". Default "0.75 1 1.25 1.5 2"; "" hides it.
 *   preview-loop  Loop the muted preview over its first N seconds ("10"). Default: the whole video.
 *   unmute-title  Unmute card headline. Default per language ("This video has sound").
 *   unmute-text   Unmute card line. Default per language ("Click to unmute").
 *   exit-poster   Image shown behind the pause screen, instead of the frozen frame.
 *   smart-pause   Boolean. Pause when the tab is hidden, play on when it comes back.
 *   bar           "rapid" (default, a display), "linear" (the real position, seekable) or "none".
 *   seek          "false" keeps a linear bar a display. The rapid bar never seeks.
 *   chapters      "0:00 Intro|1:20 Demo|2:40 Offer", or the URL of a WebVTT chapters file.
 *   captions      URL of a WebVTT file, or "en=/en.vtt nl=/nl.vtt". captions-lang, captions-on go with it.
 *   mini          A corner ("bottom-right", …): float there when a playing video scrolls out of view.
 *                 mini-width, mini-when and mini-close tune it.
 *
 * Page hooks
 *   [data-keepwatch-gate]  hidden until the CTA unlocks (or the video fails to load).
 *   Events (bubble, composed; detail {video, variant, time}): keepwatch:ready,
 *   keepwatch:play, keepwatch:unmute, keepwatch:pause, keepwatch:cta-shown,
 *   keepwatch:cta-click, keepwatch:ended, keepwatch:error, and keepwatch:progress
 *   (detail.percent 25, 50, 75, 90) for pixels and tag managers. Seconds count with sound on only.
 *   Also keepwatch:chapter (detail.index, title, start), keepwatch:seek (detail.from, to),
 *   keepwatch:captions (detail.on, lang) and keepwatch:mini (detail.floating). These four are
 *   DOM events only; nothing new is sent to the collector.
 *
 * Until it starts, the frame is a poster and no provider player exists.
 */

type Phase = "idle" | "resume" | "loading" | "muted" | "playing" | "paused" | "ended" | "error" | "expired";
type Mode = "load" | "inview" | "click" | "none";

const BEAT_EVERY_SEC = 30;
/** No "ready" from the provider in this long: the video is broken or blocked. */
const LOAD_TIMEOUT_MS = 15_000;
/** Ready, but no "play" in this long: the browser refused autoplay. Show the play button. */
const AUTOPLAY_GRACE_MS = 3_500;
/** Controls fade out after this long without pointer movement while playing. */
const IDLE_MS = 2_500;
const REWIND_SEC = 10;
const DEFAULT_SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const MILESTONES = [25, 50, 75, 90];

function sessionId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

function prefersNoAutoplay(): boolean {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return Boolean(reduced || saveData);
}

function readVariants(host: HTMLElement): Variant[] {
  const json = host.getAttribute("variants");
  if (json) {
    try {
      const list: unknown = JSON.parse(json);
      if (Array.isArray(list)) {
        const out: Variant[] = [];
        for (const item of list) {
          const v = item as { id?: unknown; src?: unknown; weight?: unknown };
          const source = typeof v.src === "string" ? resolveSource(v.src) : null;
          if (!source) continue;
          const fallback = slug(sourceKey(source));
          out.push({
            id: slug(typeof v.id === "string" ? v.id : fallback) || fallback,
            weight: typeof v.weight === "number" && v.weight >= 0 ? v.weight : 1,
            source,
          });
        }
        return out;
      }
    } catch {
      console.error("[keepwatch] `variants` is not valid JSON");
    }
  }
  const source = resolveSource(host.getAttribute("src") ?? "");
  return source ? [{ id: slug(sourceKey(source)), weight: 1, source }] : [];
}

const ALL_CONTROLS = "play rewind sound time speed captions chapters fullscreen";
/** The floating player is small: it keeps the buttons a viewer needs there. */
const MINI_CONTROLS = new Set(["play", "sound", "fullscreen"]);
/** A chapter jump lands just inside the chapter, so a provider that seeks a frame early still reports it. */
const CHAPTER_NUDGE_SEC = 0.05;

type Menu = "" | "speed" | "chapters" | "captions";

function isTouch(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/** A same-origin link keeps the landing page's utm_*; other origins get none. */
function withUtm(href: string): string {
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return href;
    const here = new URLSearchParams(location.search);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const val = here.get(k);
      if (val && !url.searchParams.has(k)) url.searchParams.set(k, val);
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return href;
  }
}

function readSpeeds(host: HTMLElement): number[] {
  const raw = host.getAttribute("speeds");
  if (raw === null) return DEFAULT_SPEEDS;
  return raw
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => n >= 0.25 && n <= 4);
}

export class KeepWatchElement extends HTMLElement {
  static observedAttributes = ["src", "variants"];

  private root: ShadowRoot;
  /** Everything the viewer sees. It floats as the mini player; the element keeps its box. */
  private frame: HTMLDivElement;
  /** What the element shows in its own place while the frame floats. */
  private ghost: HTMLDivElement;
  private stage: HTMLDivElement;
  private poster: HTMLImageElement;
  private layer: HTMLDivElement;
  private chrome: HTMLDivElement;
  private rail: Rail;
  private captionsView = new CaptionsView();
  private floater: Floater;
  private timeLabel: HTMLSpanElement | null = null;
  private chapterButton: HTMLButtonElement | null = null;
  private chapterLabel: HTMLSpanElement | null = null;
  private cleanups: (() => void)[] = [];

  private t: Strings = stringsFor("en").t;
  private locale = "en";
  private variant: Variant | null = null;
  private provider: Provider | null = null;
  private media: MediaHandle | null = null;
  private video = "";
  private duration = 0;
  private phase: Phase = "idle";
  private time = 0;
  private muted = true;
  private rate = 1;
  private rateLocked = false;
  private menu: Menu = "";
  /** Counts inits, so a slow download from an earlier `src` is dropped. */
  private gen = 0;
  /** As given by the page; `chapterList()` drops the ones past the end. */
  private chapters: Chapter[] = [];
  private chapterUrl: string | null = null;
  private chapterIndex = -1;
  private tracks: CaptionTrack[] = [];
  /** The captions showing; null is off. */
  private track: CaptionTrack | null = null;
  private corner: Corner | null = null;
  /** The viewer closed the mini player: it stays closed for this page view. */
  private miniDismissed = false;
  private resumeAt: number | null = null;
  private loadTimer = 0;
  private graceTimer = 0;
  private idleTimer = 0;
  private clockTimer = 0;
  private endTimer = 0;
  private endLeft = 0;
  /** Whether the in-player CTA is inside its show/hide window, to re-render on the edges. */
  private ctaWindow = false;
  /** Paused by smart-pause (tab hidden), so it plays on when the tab returns. */
  private hiddenPause = false;
  /** The start poster, kept so an exit poster can swap back. */
  private posterSrc = "";

  /** One viewing session: what gets reported. */
  private s = {
    sid: "",
    /** The provider is loaded and takes commands. */
    ready: false,
    /** The video has played at least once (muted or not). */
    started: false,
    /** Sound is on now: only these seconds count as watched. */
    audible: false,
    /** The viewer asked for sound (a click); the browser may still refuse it. */
    wantsSound: false,
    restartOnUnmute: false,
    startAt: 0,
    last: 0,
    savedAt: 0,
    furthest: 0,
    watched: 0,
    beatAtWatched: 0,
    unmuted: false,
    resumed: false,
    ctaShown: false,
    ctaClicked: false,
    completed: false,
    milestones: 0,
  };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = CSS;
    this.stage = el("div", { class: "stage" });
    this.poster = el("img", { class: "poster", alt: "", decoding: "async" });
    this.layer = el("div");
    this.chrome = el("div", { class: "chrome" });
    this.rail = new Rail({
      seek: (to) => this.seekTo(to),
      describe: (time) => this.describe(time),
      wake: () => this.wake(),
    });
    this.frame = el("div", { class: "frame" }, this.stage, this.poster, this.captionsView.el, this.layer, this.chrome, this.rail.el);
    this.ghost = el("div", { class: "ghost", "aria-hidden": "true" });
    this.floater = new Floater(this, this.frame, () => {
      if (this.syncMini()) this.render();
    });
    this.root.append(style, this.ghost, this.frame);
  }

  private get menuOpen(): boolean {
    return this.menu !== "";
  }

  connectedCallback() {
    installGateStyle();
    this.init();
  }

  disconnectedCallback() {
    this.beat(true);
    this.teardown();
  }

  attributeChangedCallback(_name: string, before: string | null, after: string | null) {
    if (before !== null && before !== after && this.isConnected) {
      this.beat(true);
      this.teardown();
      this.init();
    }
  }

  // ---------------------------------------------------------------- setup

  private get ctaAt(): number | null {
    return parseTime(this.getAttribute("cta-at"));
  }

  private get ctaUntil(): number | null {
    return parseTime(this.getAttribute("cta-until"));
  }

  private get pauseCta(): boolean {
    return this.getAttribute("cta-mode") === "pause";
  }

  private get canPause(): boolean {
    return !this.hasAttribute("no-pause") || this.getAttribute("no-pause") === "false";
  }

  private flag(name: string): boolean {
    return this.hasAttribute(name) && this.getAttribute(name) !== "false";
  }

  private get controllable(): boolean {
    return this.provider?.controllable ?? false;
  }

  private init() {
    ({ lang: this.locale, t: this.t } = stringsFor(this.getAttribute("lang") || document.documentElement.lang));
    this.gen++;
    this.chapters = [];
    this.chapterUrl = null;
    this.chapterIndex = -1;
    this.tracks = [];
    this.track = null;
    this.corner = null;
    this.miniDismissed = false;
    const expires = Date.parse(this.getAttribute("expires") ?? "");
    if (Number.isFinite(expires) && Date.now() >= expires) {
      this.setPhase("expired");
      return;
    }
    const variants = readVariants(this);
    if (variants.length === 0) {
      console.error("[keepwatch] needs a `src` or `variants` from a supported provider");
      return;
    }
    this.video = slug(this.getAttribute("video") ?? "") || variants[0].id;
    const saved = load(this.video);
    this.variant = pickVariant(variants, saved.variant, Math.random());
    if (!this.variant) return;
    this.provider = providerFor(this.variant.source);
    if (!this.provider) {
      console.error(`[keepwatch] no provider registered for "${this.variant.source.provider}"`);
      return;
    }
    save(this.video, { variant: this.variant.id });
    if (ctaVisible(saved.furthest, this.ctaAt)) unlockGates();

    this.s = { ...this.s, sid: sessionId(), ready: false, started: false, furthest: 0, watched: 0, beatAtWatched: 0, milestones: 0 };
    this.cleanups.push(onAudioClaimed(this, () => void this.media?.pause().catch(() => {})));
    this.readExtras();
    this.fetchMeta();
    this.setPhase("idle");
    this.emit("ready");
    this.listen();

    const mode = (this.getAttribute("autoplay") ?? "load") as Mode;
    if (mode === "click") this.begin("click");
    // Without a player API there is no muted preview to show: poster until a click.
    else if (mode === "none" || !this.controllable || prefersNoAutoplay()) return;
    else if (mode === "inview" && typeof IntersectionObserver === "function") {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            this.begin("auto");
          }
        },
        { threshold: 0.5 },
      );
      io.observe(this);
      this.cleanups.push(() => io.disconnect());
    } else this.begin("auto");
  }

  /** Chapters, captions and the mini player, as the page set them. Files are fetched when the video starts. */
  private readExtras() {
    const chapters = chaptersInput(this.getAttribute("chapters"));
    if (chapters && "inline" in chapters) this.chapters = chapters.inline;
    else if (chapters) this.chapterUrl = chapters.url;

    const lang = this.getAttribute("captions-lang");
    this.tracks = parseCaptionTracks(this.getAttribute("captions"), lang);
    this.track = pickCaptionTrack(this.tracks, loadPrefs().captions, this.flag("captions-on"), [lang, this.locale, navigator.language]);

    this.corner = miniCorner(this.getAttribute("mini"));
    if (this.corner) this.cleanups.push(this.floater.watch());
  }

  /** The first start: get the files the page pointed at. Each is fetched once. */
  private loadExtras() {
    this.captionsView.select(this.track);
    const url = this.chapterUrl;
    if (!url) return;
    this.chapterUrl = null;
    const gen = this.gen;
    void fetchText(url, "chapters").then((text) => {
      if (gen !== this.gen) return;
      this.chapters = chaptersFromCues(parseVtt(text));
      this.chapterIndex = -1;
      this.renderChrome();
      this.paintProgress();
      if (this.phase === "playing" || this.phase === "paused") this.syncChapter();
    });
  }

  /** Page-level listeners: report on hide, show controls on movement, close the menu outside. */
  private listen() {
    const onHide = () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) this.beat(true);
      if (!this.flag("smart-pause") || !this.canPause || !this.media) return;
      if (hidden && this.phase === "playing") {
        this.hiddenPause = true;
        void this.media.pause().catch(() => {});
      } else if (!hidden && this.hiddenPause) {
        this.hiddenPause = false;
        if (this.phase === "paused") void this.media.play().catch(() => {});
      }
    };
    const onMove = () => this.wake();
    const onLeave = () => {
      if (!this.menuOpen) this.removeAttribute("data-active");
    };
    const onFullscreen = () => {
      if (this.syncMini()) this.render();
      else this.renderChrome();
    };
    const onDocClick = (e: MouseEvent) => {
      if (this.menuOpen && !e.composedPath().includes(this)) this.showMenu("");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.menuOpen) this.showMenu("", true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerleave", onLeave);
    this.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("click", onDocClick);
    this.cleanups.push(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerleave", onLeave);
      this.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("click", onDocClick);
    });
  }

  private teardown() {
    for (const c of this.cleanups.splice(0)) c();
    this.captionsView.select(null);
    this.unmount();
  }

  private clearTimers() {
    window.clearTimeout(this.loadTimer);
    window.clearTimeout(this.graceTimer);
    window.clearTimeout(this.idleTimer);
    window.clearInterval(this.clockTimer);
    window.clearInterval(this.endTimer);
  }

  private unmount() {
    this.clearTimers();
    this.media?.destroy();
    this.media = null;
    this.s.ready = false;
  }

  /** Poster and duration from the provider, unless the page gave a poster. */
  private fetchMeta() {
    const v = this.variant;
    const poster = this.getAttribute("poster");
    this.posterSrc = poster ?? "";
    if (poster) this.poster.src = poster;
    if (!v || !this.provider?.meta) return;
    this.provider
      .meta(v.source)
      .then((meta) => {
        if (!meta) return;
        if (!poster && meta.poster) {
          this.posterSrc = meta.poster;
          this.render();
        }
        if (!this.duration && meta.duration) this.duration = meta.duration;
      })
      .catch(() => {
        // No poster: the frame stays black until the video starts.
      });
  }

  // ------------------------------------------------------------ lifecycle

  private begin(trigger: "auto" | "click") {
    const mode = this.getAttribute("resume") ?? "ask";
    const at = mode === "off" ? null : resumeFrom(load(this.video).pos, this.duration || Number.POSITIVE_INFINITY);
    if (at !== null && this.controllable) {
      if (mode === "auto") {
        this.start({ sound: trigger === "click", at, resumed: true });
        return;
      }
      this.resumeAt = at;
      this.setPhase("resume");
      return;
    }
    this.start({ sound: trigger === "click", at: 0, resumed: false });
  }

  /**
   * Mount the provider and play. Every start asks the provider to autoplay;
   * with `sound` it asks for sound too. What the browser actually allowed
   * shows up in the play event (see `onPlay`), never assumed here.
   */
  private start(opts: { sound: boolean; at: number; resumed: boolean }) {
    const v = this.variant;
    const provider = this.provider;
    if (!v || !provider) return;
    this.unmount();
    const s = this.s;
    s.wantsSound = opts.sound;
    s.audible = false;
    s.restartOnUnmute = !opts.sound && opts.at === 0 && this.getAttribute("unmute-restart") !== "false";
    s.startAt = opts.at;
    s.last = opts.at;
    s.resumed = s.resumed || opts.resumed;
    this.time = opts.at;
    this.muted = !opts.sound;
    this.setPhase("loading");
    this.loadExtras();

    const media = provider.mount(
      this.stage,
      v.source,
      { muted: !opts.sound, startAt: opts.at, label: this.getAttribute("label") ?? "Video" },
      {
        ready: (d) => {
          if (this.media !== media) return;
          s.ready = true;
          if (d > 0) this.duration = d;
          window.clearTimeout(this.loadTimer);
          window.clearTimeout(this.graceTimer);
          this.graceTimer = window.setTimeout(() => {
            if (!s.started && this.media === media) this.setPhase("idle");
          }, AUTOPLAY_GRACE_MS);
        },
        play: () => {
          if (this.media === media) void this.onPlay(media);
        },
        pause: () => {
          if (this.media !== media) return;
          // A paused muted preview keeps its unmute card: browsers pause silent
          // autoplay off screen, and the card's click plays on with sound anyway.
          if (this.phase === "playing") {
            this.setPhase("paused");
            this.emit("pause");
          }
        },
        ended: () => {
          if (this.media !== media) return;
          if (this.phase === "muted") {
            // The muted preview loops; only a listened-to ending is an ending.
            void media.seek(0).then(() => media.play()).catch(() => {});
            return;
          }
          s.completed = true;
          save(this.video, { pos: this.duration });
          this.beat();
          this.emit("ended");
          if (this.getAttribute("end") === "loop") {
            s.last = 0;
            void media.seek(0).then(() => media.play()).catch(() => {});
            return;
          }
          this.setPhase("ended");
          if (this.getAttribute("end") === "redirect") this.countdown();
        },
        time: (sec, d) => {
          if (this.media === media) this.tick(sec, d);
        },
        error: (reason) => {
          if (this.media !== media) return;
          console.error(`[keepwatch] ${reason}`);
          this.fail();
        },
      },
    );
    this.media = media;
    this.loadTimer = window.setTimeout(() => {
      if (!s.ready && this.media === media) this.fail();
    }, LOAD_TIMEOUT_MS);
  }

  private async onPlay(media: MediaHandle) {
    const s = this.s;
    window.clearTimeout(this.graceTimer);
    const first = !s.started;
    if (first) {
      s.started = true;
      this.beat();
      const speed = Number(this.getAttribute("speed"));
      if (speed > 0 && speed !== 1 && this.controllable) {
        void media.setRate(speed).then((ok) => {
          if (ok) this.rate = speed;
          this.renderChrome();
        });
      }
    }
    if (!this.controllable) {
      // Handed over to the provider's own player: sound is on, the clock times the CTA.
      s.audible = true;
      s.unmuted = true;
      this.muted = false;
      claimAudio(this);
      this.startClock();
      this.setPhase("playing");
      this.emit("play");
      return;
    }
    if (s.wantsSound && !s.audible) {
      // Browsers may start a with-sound request silently (Safari, no prior click).
      const silent = await media.isMuted().catch(() => true);
      if (this.media !== media) return;
      if (silent) {
        s.wantsSound = false;
        s.restartOnUnmute = s.startAt === 0 && this.getAttribute("unmute-restart") !== "false";
        this.muted = true;
      } else {
        s.audible = true;
        s.unmuted = true;
        this.muted = false;
        claimAudio(this);
        this.emit("unmute");
      }
    }
    const next: Phase = s.audible || !this.muted ? "playing" : "muted";
    if (this.phase === next) return;
    this.setPhase(next);
    if (first || next === "playing") this.emit("play");
  }

  private tick(seconds: number, duration: number) {
    const v = this.variant!;
    const s = this.s;
    if (duration > 0) this.duration = duration;
    this.time = seconds;
    this.paintProgress();
    this.captionsView.update(seconds);
    if (this.phase === "muted") {
      const loop = parseTime(this.getAttribute("preview-loop"));
      if (loop && seconds >= loop) void this.media?.seek(0).catch(() => {});
      return;
    }
    this.syncChapter();
    if (!s.audible) return;
    const delta = seconds - s.last;
    if (delta > 0 && delta < 1.5) s.watched += delta;
    s.last = seconds;
    s.furthest = Math.max(s.furthest, Math.floor(seconds));
    if (seconds - s.savedAt >= 2 || seconds < s.savedAt) {
      s.savedAt = seconds;
      save(this.video, { variant: v.id, pos: seconds });
    }
    this.checkCta(Math.max(s.furthest, load(this.video).furthest));
    const inWindow = this.ctaInWindow();
    if (inWindow !== this.ctaWindow) {
      this.ctaWindow = inWindow;
      this.render();
    }
    this.checkMilestones();
    if (s.watched - s.beatAtWatched >= BEAT_EVERY_SEC) {
      s.beatAtWatched = s.watched;
      this.beat();
    }
  }

  private checkCta(reached: number) {
    const s = this.s;
    if (s.ctaShown || !ctaVisible(reached, this.ctaAt)) return;
    s.ctaShown = true;
    unlockGates();
    if (this.flag("cta-exit-fullscreen") && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.render();
    this.beat();
    this.emit("cta-shown");
  }

  /** Timed CTA: reached, and not yet past `cta-until`. */
  private ctaInWindow(): boolean {
    const until = this.ctaUntil;
    const reached = ctaVisible(Math.max(this.s.furthest, load(this.video).furthest), this.ctaAt);
    return reached && (until === null || this.time < until);
  }

  /** end="redirect": count down on the end screen, then go. */
  private countdown() {
    const href = this.getAttribute("end-redirect");
    if (!href) return;
    this.endLeft = Math.max(0, Math.floor(Number(this.getAttribute("end-countdown") ?? 5)) || 0);
    window.clearInterval(this.endTimer);
    const step = () => {
      if (this.phase !== "ended") {
        window.clearInterval(this.endTimer);
        return;
      }
      if (this.endLeft <= 0) {
        window.clearInterval(this.endTimer);
        location.href = withUtm(href);
        return;
      }
      this.render();
      this.endLeft--;
    };
    step();
    this.endTimer = window.setInterval(step, 1000);
  }

  /** keepwatch:progress at 25/50/75/90% reached with sound, once each per session. */
  private checkMilestones() {
    const s = this.s;
    const d = this.duration;
    if (!(d > 0)) return;
    while (s.milestones < MILESTONES.length && s.furthest >= (d * MILESTONES[s.milestones]) / 100) {
      const percent = MILESTONES[s.milestones++];
      this.dispatchEvent(
        new CustomEvent("keepwatch:progress", {
          bubbles: true,
          composed: true,
          detail: { video: this.video, variant: this.variant?.id, time: this.time, percent },
        }),
      );
    }
  }

  /**
   * For providers without time events (Loom): the CTA runs on the clock
   * since the click. Only the gate uses it; it is never reported as watched.
   */
  private startClock() {
    window.clearInterval(this.clockTimer);
    const t0 = performance.now();
    const from = this.s.startAt;
    this.clockTimer = window.setInterval(() => {
      const reached = Math.floor(from + (performance.now() - t0) / 1000);
      save(this.video, { furthest: reached });
      this.checkCta(reached);
      if (this.s.ctaShown) window.clearInterval(this.clockTimer);
    }, 1000);
  }

  private fail() {
    this.clearTimers();
    unlockGates();
    this.setPhase("error");
    this.emit("error");
  }

  // -------------------------------------------------------------- actions

  /** The poster's play button: a fresh start, or a play the browser refused to autoplay. */
  private playClick = () => {
    const media = this.media;
    if (!media || !this.s.ready) {
      this.begin("click");
      return;
    }
    // Loaded but blocked: play the same player with sound, inside this click.
    this.s.wantsSound = true;
    this.muted = false;
    void media.setMuted(false).then(() => media.play()).catch(() => this.begin("click"));
  };

  private unmute = () => {
    const media = this.media;
    if (!media) return;
    const s = this.s;
    const restart = s.restartOnUnmute;
    s.restartOnUnmute = false;
    s.wantsSound = true;
    s.audible = true;
    s.unmuted = true;
    if (restart) {
      s.last = 0;
      this.time = 0;
    }
    this.muted = false;
    claimAudio(this);
    const fs = this.getAttribute("fullscreen-on-unmute");
    if (fs === "always" || (fs === "mobile" && isTouch()) || (fs === "desktop" && !isTouch())) this.fullscreen();
    // Switch the view now; the provider's play/pause events keep it honest after.
    this.setPhase("playing");
    this.beat();
    this.emit("unmute");
    void (async () => {
      if (restart) await media.seek(0).catch(() => {});
      await media.setMuted(false).catch(() => {});
      await media.play().catch(() => {});
    })();
  };

  private toggle = () => {
    const media = this.media;
    if (!media) return;
    this.hiddenPause = false;
    if (this.phase === "playing" && this.canPause) void media.pause().catch(() => {});
    else if (this.phase === "paused") {
      claimAudio(this);
      void media.play().catch(() => {});
    }
  };

  private rewind = () => {
    const media = this.media;
    if (!media) return;
    const to = Math.max(0, this.time - REWIND_SEC);
    // Going back never counts as watching, and never lowers `furthest`.
    this.s.last = to;
    this.time = to;
    this.paintProgress();
    void media.seek(to).catch(() => {});
  };

  /**
   * Go to a time: the seekable bar and the chapter list. Like going back, a
   * jump is not watching: no seconds are counted for it.
   */
  private seekTo(to: number) {
    const media = this.media;
    if (!media) return;
    const from = this.time;
    const target = clampSeek(to, this.duration);
    this.s.last = target;
    this.time = target;
    this.paintProgress();
    this.captionsView.update(target);
    void media.seek(target).catch(() => {});
    this.emit("seek", { from, to: target });
    this.syncChapter();
  }

  private chapterList(): Chapter[] {
    return fitChapters(this.chapters, this.duration);
  }

  /** The chapter under the clock changed: update its title in place and tell the page. */
  private syncChapter() {
    const list = this.chapterList();
    const at = chapterAt(list, this.time);
    if (at === this.chapterIndex) return;
    this.chapterIndex = at;
    const chapter = list[at];
    if (this.chapterLabel) this.chapterLabel.textContent = chapter?.title ?? this.t.chapters;
    this.chapterButton?.setAttribute("aria-label", this.chapterName(chapter));
    this.chrome.querySelectorAll(".menu.chapters button").forEach((b, i) => {
      if (i === at) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    if (chapter) this.emit("chapter", { index: at, title: chapter.title, start: chapter.start });
  }

  private chapterName(chapter: Chapter | undefined): string {
    return chapter ? `${this.t.chapters}: ${chapter.title}` : this.t.chapters;
  }

  private jumpChapter(chapter: Chapter) {
    this.showMenu("", true);
    this.seekTo(chapter.start > 0 ? chapter.start + CHAPTER_NUDGE_SEC : 0);
  }

  /** The bar's tooltip: the time, and the chapter there. */
  private describe(time: number): string {
    const list = this.chapterList();
    const chapter = list[chapterAt(list, time)];
    return chapter ? `${mmss(time)} · ${chapter.title}` : mmss(time);
  }

  /** Turn captions on (a track) or off (null), and remember it for the next video and visit. */
  private setCaptions(track: CaptionTrack | null) {
    this.track = track;
    this.captionsView.select(track);
    this.captionsView.update(this.time);
    savePrefs({ captions: track ? track.lang || "on" : "off" });
    this.emit("captions", { on: track !== null, lang: track ? track.lang : null });
    if (this.menuOpen) this.showMenu("", true);
    // The one-file switch is updated in place, so a keyboard user keeps their focus on it.
    else this.chrome.querySelector(".ctl.cc")?.setAttribute("aria-pressed", String(track !== null));
  }

  private trackName(track: CaptionTrack): string {
    if (!track.lang) return this.t.captions;
    try {
      const name = new Intl.DisplayNames([this.locale], { type: "language" }).of(track.lang);
      if (name && name !== track.lang) return name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
      // An unknown tag, or no Intl.DisplayNames: show the code.
    }
    return track.lang.toUpperCase();
  }

  /** Float or return the player, as mini.ts decides. True when it changed (the caller renders). */
  private syncMini(): boolean {
    const want = shouldFloat({
      corner: this.corner,
      when: miniWhen(this.getAttribute("mini-when")),
      phase: this.phase,
      inView: this.floater.inView,
      dismissed: this.miniDismissed,
      fullscreen: Boolean(document.fullscreenElement),
      floating: this.floater.floating,
    });
    return this.setFloating(want);
  }

  private setFloating(want: boolean): boolean {
    if (want === this.floater.floating) return false;
    if (want && this.corner) this.floater.float(this.corner, Number(this.getAttribute("mini-width")) || null);
    else this.floater.unfloat();
    this.menu = "";
    this.emit("mini", { floating: this.floater.floating });
    return true;
  }

  private closeMini = () => {
    this.miniDismissed = true;
    if (this.syncMini()) this.render();
  };

  private backToVideo = () => {
    this.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  };

  private toggleSound = () => {
    const media = this.media;
    if (!media) return;
    this.muted = !this.muted;
    this.s.audible = !this.muted;
    if (!this.muted) {
      this.s.unmuted = true;
      claimAudio(this);
    }
    void media.setMuted(this.muted).catch(() => {});
    this.renderChrome();
  };

  private setRate(rate: number) {
    const media = this.media;
    this.showMenu("", true);
    if (!media) return;
    void media.setRate(rate).then((ok) => {
      if (ok) this.rate = rate;
      else this.rateLocked = true;
      this.renderChrome();
    });
  }

  /** Open one menu (or none). `refocus` puts the keyboard back on the button that opened it. */
  private showMenu(menu: Menu, refocus = false) {
    const was = this.menu;
    this.menu = menu;
    this.renderChrome();
    const find = (q: string) => this.chrome.querySelector<HTMLButtonElement>(q);
    if (menu) (find('.menu:not([hidden]) button[aria-current="true"]') ?? find(".menu:not([hidden]) button"))?.focus();
    else if (refocus && was) find(`[data-menu="${was}"]`)?.focus();
  }

  private toggleMenu(menu: Menu) {
    this.showMenu(this.menu === menu ? "" : menu, true);
  }

  private fullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    // Full screen is the element itself: bring the mini player home first, so it never covers its own video.
    if (this.setFloating(false)) this.render();
    const resync = () => {
      if (this.syncMini()) this.render();
    };
    if (this.requestFullscreen) {
      void this.requestFullscreen().catch(() => {
        resync();
        return this.media?.nativeFullscreen?.();
      });
    } else {
      resync();
      void this.media?.nativeFullscreen?.().catch(() => {});
    }
  };

  private replay = () => {
    const media = this.media;
    if (!media) return;
    this.s.last = 0;
    window.clearInterval(this.endTimer);
    claimAudio(this);
    void media
      .seek(0)
      .then(() => media.play())
      .catch(() => {});
  };

  private ctaClick = (e: MouseEvent) => {
    this.s.ctaClicked = true;
    this.beat();
    this.emit("cta-click");
    const href = this.getAttribute("cta-href") ?? "";
    if (href.startsWith("#")) {
      // Same-page anchor: the target lives in the page, not in this shadow root.
      e.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
  };

  /** Show the controls, and fade them again after a while of stillness. */
  private wake() {
    this.setAttribute("data-active", "");
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (this.phase === "playing" && !this.menuOpen) this.removeAttribute("data-active");
    }, IDLE_MS);
  }

  // ------------------------------------------------------------ rendering

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.setAttribute("data-phase", phase);
    if (phase !== "playing" && phase !== "paused") this.menu = "";
    this.syncMini();
    this.render();
  }

  private cta(): HTMLAnchorElement | null {
    const href = this.getAttribute("cta-href");
    if (!href) return null;
    const target = href.startsWith("#") ? href : withUtm(href);
    const a = el("a", { class: "btn", href: target, part: "cta" }, this.getAttribute("cta-text") ?? this.t.cta);
    const tab = this.getAttribute("cta-target");
    if (tab) a.setAttribute("target", tab);
    if (tab === "_blank") a.setAttribute("rel", "noopener");
    a.addEventListener("click", this.ctaClick);
    return a;
  }

  private button(content: string | Node, onClick: () => void, cls = "btn", label?: string): HTMLButtonElement {
    const b = el("button", { type: "button", class: cls }, content);
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  private ctl(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
    return this.button(icon(name), onClick, "ctl", label);
  }

  private render() {
    const t = this.t;
    const phase = this.phase;
    const unlocked = ctaVisible(Math.max(this.s.furthest, load(this.video).furthest), this.ctaAt);
    const endPoster = phase === "ended" && this.getAttribute("end") === "poster" ? this.getAttribute("end-poster") : null;
    const exitPoster = phase === "paused" ? this.getAttribute("exit-poster") : endPoster;
    const want = exitPoster ?? this.posterSrc;
    if (want && this.poster.getAttribute("src") !== want) this.poster.src = want;
    this.poster.hidden = !(phase === "idle" || phase === "resume" || phase === "loading" || phase === "expired" || exitPoster);
    const touch = isTouch();
    const nodes: Node[] = [];

    if (phase === "expired") {
      nodes.push(el("div", { class: "panel" }, el("p", {}, this.getAttribute("expired-text") || t.expired)));
    }
    if (phase === "idle") {
      const facade = el("button", { type: "button", class: "facade", "aria-label": t.play }, el("span", { class: "play" }, icon("play")));
      facade.addEventListener("click", this.playClick);
      nodes.push(facade);
    }
    if (phase === "resume" && this.resumeAt !== null) {
      const at = this.resumeAt;
      nodes.push(
        el(
          "div",
          { class: "panel" },
          el("p", {}, this.getAttribute("resume-title") || t.resumeTitle),
          el(
            "div",
            { class: "actions" },
            this.button(`${this.getAttribute("resume-continue") || t.resumeContinue} (${mmss(at)})`, () => this.start({ sound: true, at, resumed: true })),
            this.button(this.getAttribute("resume-restart") || t.resumeRestart, () => this.start({ sound: true, at: 0, resumed: false }), "btn ghost"),
          ),
        ),
      );
    }
    if (phase === "muted") {
      const title = (touch && this.getAttribute("unmute-title-mobile")) || this.getAttribute("unmute-title") || t.started;
      const sub = (touch && this.getAttribute("unmute-text-mobile")) || this.getAttribute("unmute-text") || t.unmute;
      const b = el(
        "button",
        { type: "button", class: "unmute", "aria-label": `${title}. ${sub}` },
        el("span", { class: "card" }, icon("speaker"), el("span", { class: "title" }, title), el("span", { class: "sub" }, sub)),
      );
      b.addEventListener("click", this.unmute);
      nodes.push(b);
    }
    if ((phase === "playing" || phase === "paused") && this.controllable && (this.canPause || phase === "paused")) {
      const surface = el("button", { type: "button", class: "surface", "aria-label": phase === "playing" ? t.pause : t.resume });
      surface.addEventListener("click", this.toggle);
      nodes.push(surface);
    }
    if (phase === "paused") {
      const cta = unlocked || this.pauseCta ? this.cta() : null;
      // In the mini player there is no room for the pause panel's text: the play button is in the controls.
      const words = this.floater.floating ? [] : [el("p", {}, t.paused)];
      const again = this.floater.floating ? [] : [this.button(t.resumeContinue, this.toggle)];
      nodes.push(el("div", { class: "panel" }, ...words, el("div", { class: "actions" }, ...again, ...(cta ? [cta] : []))));
    }
    if (phase === "ended") {
      const cta = this.cta();
      const again = this.controllable ? [this.button(t.replay, this.replay, "btn ghost")] : [];
      const redirect = this.getAttribute("end") === "redirect" && this.getAttribute("end-redirect");
      const message = redirect ? [el("p", {}, (this.getAttribute("end-text") || t.redirecting).replace("{s}", String(this.endLeft)))] : [];
      nodes.push(el("div", { class: endPoster ? "panel soft" : "panel" }, ...message, el("div", { class: "actions" }, ...(cta ? [cta] : []), ...again)));
    }
    if (phase === "error" && this.variant) {
      const name = providerName(this.variant.source.provider);
      const open = el(
        "a",
        { class: "btn ghost", href: plainUrl(this.variant.source), target: "_blank", rel: "noopener" },
        name ? t.openOn.replace("{provider}", name) : t.openVideo,
      );
      const cta = this.cta();
      nodes.push(el("div", { class: "panel" }, el("p", {}, t.error), el("div", { class: "actions" }, open, ...(cta ? [cta] : []))));
    }
    let ctaOnVideo = false;
    if (phase === "playing" && !this.pauseCta && this.ctaInWindow()) {
      const cta = this.cta();
      if (cta) nodes.push(el("div", { class: this.controllable ? "cta" : "cta bare" }, cta));
      ctaOnVideo = cta !== null;
    }
    this.captionsView.el.classList.toggle("over-cta", ctaOnVideo);

    // Floating: a way back and a way out on the mini player, and a note where the player was.
    const floating = this.floater.floating;
    if (floating) {
      const back = this.button(icon("restore"), this.backToVideo, "mini-btn back", t.miniBack);
      nodes.push(back);
      if (this.getAttribute("mini-close") !== "false") nodes.push(this.button(icon("x"), this.closeMini, "mini-btn close", t.miniClose));
      const image = this.posterSrc ? [el("img", { src: this.posterSrc, alt: "" })] : [];
      this.ghost.replaceChildren(...image, el("span", {}, t.miniPlaying));
    } else if (this.ghost.firstChild) this.ghost.replaceChildren();

    this.layer.replaceChildren(...nodes);
    this.renderChrome();
    this.paintProgress();
  }

  /**
   * The control bar, only once sound is on: the muted preview shows the
   * unmute card alone, with no bar that looks like minutes already missed.
   * `controls` picks the buttons; `no-pause` drops pausing; `bar` the rail.
   */
  private renderChrome() {
    const t = this.t;
    const show = (this.phase === "playing" || this.phase === "paused") && this.controllable;
    const asked = (this.getAttribute("controls") ?? ALL_CONTROLS).split(/[\s,]+/).filter(Boolean);
    const want = new Set(this.floater.floating ? asked.filter((c) => MINI_CONTROLS.has(c)) : asked);
    const mode = barMode(this.getAttribute("bar"));
    this.chrome.hidden = !show || want.size === 0;
    this.rail.hidden = !show || mode === "none";
    this.rail.configure({ seekable: show && canSeek(mode, this.getAttribute("seek")), label: t.seek });
    this.chrome.classList.toggle("open", this.menuOpen);
    this.timeLabel = null;
    this.chapterButton = null;
    this.chapterLabel = null;
    if (!show) {
      this.chrome.replaceChildren();
      return;
    }
    const playing = this.phase === "playing";
    const full = document.fullscreenElement === this;
    const group = (cls: string, ...kids: Node[]) => (kids.length ? [el("div", { class: cls }, ...kids)] : []);

    const left: Node[] = [];
    if (want.has("play") && (this.canPause || !playing)) {
      left.push(this.ctl(playing ? "pause" : "play", playing ? t.pause : t.resume, this.toggle));
    }
    const middle: Node[] = [];
    if (want.has("rewind")) middle.push(this.ctl("rewind10", t.rewind, this.rewind));
    if (want.has("sound")) middle.push(this.ctl(this.muted ? "muted" : "volume", this.muted ? t.soundOn : t.mute, this.toggleSound));
    if (want.has("time")) {
      this.timeLabel = el("span", { class: "time", "aria-hidden": "true" }, clock(this.time));
      middle.push(this.timeLabel);
    }
    const chapters = this.chapterList();
    if (want.has("chapters") && chapters.length > 0) {
      const current = chapters[chapterAt(chapters, this.time)];
      this.chapterLabel = el("span", { class: "label" }, current?.title ?? t.chapters);
      const chip = this.button(icon("list"), () => this.toggleMenu("chapters"), "ctl chip", this.chapterName(current));
      chip.append(this.chapterLabel);
      chip.setAttribute("aria-expanded", String(this.menu === "chapters"));
      chip.setAttribute("aria-haspopup", "true");
      chip.setAttribute("data-menu", "chapters");
      this.chapterButton = chip;
      if (this.menu === "chapters") {
        const list = el("div", { class: "menu list start chapters", role: "group", "aria-label": t.chapters }, el("h3", {}, t.chapters));
        for (const c of chapters) {
          const item = this.button(el("span", { class: "when" }, mmss(c.start)), () => this.jumpChapter(c), "");
          item.append(el("span", { class: "what" }, c.title), icon("check"));
          if (c === current) item.setAttribute("aria-current", "true");
          list.append(item);
        }
        middle.push(list);
      }
      middle.push(chip);
    }
    const right: Node[] = [];
    const speeds = readSpeeds(this);
    if (want.has("speed") && speeds.length > 0 && !this.rateLocked) {
      const gear = this.ctl("settings", t.settings, () => this.toggleMenu("speed"));
      gear.setAttribute("aria-expanded", String(this.menu === "speed"));
      gear.setAttribute("aria-haspopup", "true");
      gear.setAttribute("data-menu", "speed");
      const menu = el("div", { class: "menu", role: "group", "aria-label": t.speed }, el("h3", {}, t.speed));
      menu.hidden = this.menu !== "speed";
      for (const r of speeds) {
        const item = this.button(el("span", {}, r === 1 ? t.normal : `${r}×`), () => this.setRate(r), "");
        item.append(icon("check"));
        item.setAttribute("aria-pressed", String(r === this.rate));
        menu.append(item);
      }
      right.push(menu, gear);
    }
    if (want.has("captions") && this.tracks.length > 0) {
      const on = this.track !== null;
      if (this.tracks.length === 1) {
        // One file: the button is the switch.
        const only = this.tracks[0];
        const cc = this.ctl("captions", t.captions, () => this.setCaptions(this.track ? null : only));
        cc.classList.add("cc");
        cc.setAttribute("aria-pressed", String(on));
        right.push(cc);
      } else {
        const cc = this.ctl("captions", t.captions, () => this.toggleMenu("captions"));
        cc.setAttribute("aria-pressed", String(on));
        cc.setAttribute("aria-expanded", String(this.menu === "captions"));
        cc.setAttribute("aria-haspopup", "true");
        cc.setAttribute("data-menu", "captions");
        if (this.menu === "captions") {
          const list = el("div", { class: "menu list", role: "group", "aria-label": t.captions }, el("h3", {}, t.captions));
          const choices: [string, CaptionTrack | null][] = [[t.captionsOff, null], ...this.tracks.map((tr): [string, CaptionTrack] => [this.trackName(tr), tr])];
          for (const [name, tr] of choices) {
            const item = this.button(el("span", {}, name), () => this.setCaptions(tr), "");
            item.append(icon("check"));
            if (tr?.lang) item.lang = tr.lang;
            item.setAttribute("aria-pressed", String(tr === this.track));
            list.append(item);
          }
          right.push(list);
        }
        right.push(cc);
      }
    }
    if (want.has("fullscreen")) right.push(this.ctl(full ? "minimize" : "maximize", full ? t.exitFullscreen : t.fullscreen, this.fullscreen));

    this.chrome.replaceChildren(
      el(
        "div",
        { class: "controls" },
        ...group("group wide", ...left),
        ...group("group", ...middle),
        el("span", { style: "flex:1" }),
        ...group("group", ...right),
      ),
    );
  }

  private paintProgress() {
    const d = this.duration;
    const mode = barMode(this.getAttribute("bar"));
    const mobile = isTouch() ? Number(this.getAttribute("bar-curve-mobile")) : 0;
    const curve = mobile || Number(this.getAttribute("bar-curve")) || BAR_CURVE;
    this.style.setProperty("--kw-p", String(barPosition(this.time, d, mode, curve)));
    if (this.timeLabel) this.timeLabel.textContent = clock(this.time);
    // Marks use the same curve as the fill, so on a rapid bar they sit where the fill will meet them.
    this.rail.marks(chapterMarks(this.chapters, d, mode, curve));
    const list = this.chapterList();
    const chapter = list[chapterAt(list, this.time)];
    const text = `${mmss(this.time)} ${this.t.of} ${mmss(d)}`;
    this.rail.paint({ time: this.time, duration: d, text: chapter ? `${text}, ${this.t.chapter}: ${chapter.title}` : text });
  }

  // ------------------------------------------------------------ reporting

  private emit(name: string, extra: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(`keepwatch:${name}`, {
        bubbles: true,
        composed: true,
        detail: { video: this.video, variant: this.variant?.id, time: this.time, ...extra },
      }),
    );
  }

  /**
   * Send the whole session state to `collect`. text/plain and no-cors keep
   * it a "simple" request: no preflight, no CORS setup on the collector
   * beyond checking Origin, and sendBeacon works the same way on page hide.
   */
  private beat(final = false) {
    const endpoint = this.getAttribute("collect");
    const v = this.variant;
    const s = this.s;
    if (!endpoint || !v || !s.started) return;
    const body: Beat = {
      sid: s.sid,
      site: location.hostname.toLowerCase(),
      video: this.video,
      variant: v.id,
      placement: slug(this.getAttribute("placement") ?? "") || "main",
      locale: this.locale,
      durationSec: Math.floor(this.duration),
      furthestSec: s.furthest,
      watchedSec: Math.floor(s.watched),
      unmuted: s.unmuted,
      resumed: s.resumed,
      ctaShown: s.ctaShown,
      ctaClicked: s.ctaClicked,
      completed: s.completed,
      mobile: window.matchMedia?.("(pointer: coarse)").matches ?? false,
      ...readUtm(location.search),
    };
    const json = JSON.stringify(body);
    if (final && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(endpoint, new Blob([json], { type: "text/plain" }));
      return;
    }
    fetch(endpoint, { method: "POST", mode: "no-cors", keepalive: true, headers: { "content-type": "text/plain" }, body: json }).catch(
      () => {
        // Measurement is best effort. The viewer never sees this fail.
      },
    );
  }
}

/** Register <keep-watch> once. Safe to call from several bundles. */
export function define(tag = "keep-watch"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, KeepWatchElement);
  }
}
