import {
  clock,
  ctaVisible,
  displayProgress,
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
import { claimAudio, installGateStyle, load, onAudioClaimed, save, unlockGates } from "./store.ts";
import { CSS } from "./styles.ts";

/**
 * <keep-watch>: a Vidalytics-style player over Vimeo, YouTube, Loom or a
 * video file.
 *
 *   <keep-watch src="https://vimeo.com/1226915932" cta-at="6:11"
 *               cta-href="#book" collect="https://getclark.app/api/vsl"></keep-watch>
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
 *   unmute-title  Unmute card headline. Default per language ("Your video is playing").
 *   unmute-text   Unmute card line. Default per language ("Click to unmute").
 *   exit-poster   Image shown behind the pause screen, instead of the frozen frame.
 *   smart-pause   Boolean. Pause when the tab is hidden, play on when it comes back.
 *
 * Page hooks
 *   [data-keepwatch-gate]  hidden until the CTA unlocks (or the video fails to load).
 *   Events (bubble, composed; detail {video, variant, time}): keepwatch:ready,
 *   keepwatch:play, keepwatch:unmute, keepwatch:pause, keepwatch:cta-shown,
 *   keepwatch:cta-click, keepwatch:ended, keepwatch:error, and keepwatch:progress
 *   (detail.percent 25, 50, 75, 90) for pixels and tag managers. Seconds count with sound on only.
 *
 * Until it starts, the frame is a poster and no provider player exists.
 */

type Phase = "idle" | "resume" | "loading" | "muted" | "playing" | "paused" | "ended" | "error";
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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

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
  private stage: HTMLDivElement;
  private poster: HTMLImageElement;
  private layer: HTMLDivElement;
  private chrome: HTMLDivElement;
  private rail: HTMLDivElement;
  private timeLabel: HTMLSpanElement | null = null;
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
  private menuOpen = false;
  private resumeAt: number | null = null;
  private loadTimer = 0;
  private graceTimer = 0;
  private idleTimer = 0;
  private clockTimer = 0;
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
    this.rail = el(
      "div",
      { class: "rail", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" },
      el("div", { class: "fill" }),
    );
    this.root.append(style, this.stage, this.poster, this.layer, this.chrome, this.rail);
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

  private get controllable(): boolean {
    return this.provider?.controllable ?? false;
  }

  private init() {
    ({ lang: this.locale, t: this.t } = stringsFor(this.getAttribute("lang") ?? document.documentElement.lang));
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

  /** Page-level listeners: report on hide, show controls on movement, close the menu outside. */
  private listen() {
    const onHide = () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) this.beat(true);
      if (!this.hasAttribute("smart-pause") || !this.media) return;
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
    const onFullscreen = () => this.renderChrome();
    const onDocClick = (e: MouseEvent) => {
      if (this.menuOpen && !e.composedPath().includes(this)) this.toggleMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.menuOpen) this.toggleMenu(false);
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
    this.unmount();
  }

  private clearTimers() {
    window.clearTimeout(this.loadTimer);
    window.clearTimeout(this.graceTimer);
    window.clearTimeout(this.idleTimer);
    window.clearInterval(this.clockTimer);
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
    const at = resumeFrom(load(this.video).pos, this.duration || Number.POSITIVE_INFINITY);
    if (at !== null && this.controllable) {
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
    s.restartOnUnmute = !opts.sound && opts.at === 0;
    s.startAt = opts.at;
    s.last = opts.at;
    s.resumed = s.resumed || opts.resumed;
    this.time = opts.at;
    this.muted = !opts.sound;
    this.setPhase("loading");

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
          this.setPhase("ended");
          this.beat();
          this.emit("ended");
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
        s.restartOnUnmute = s.startAt === 0;
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
    if (this.phase === "muted") {
      const loop = parseTime(this.getAttribute("preview-loop"));
      if (loop && seconds >= loop) void this.media?.seek(0).catch(() => {});
      return;
    }
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
    this.render();
    this.beat();
    this.emit("cta-shown");
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
    if (this.phase === "playing") void media.pause().catch(() => {});
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
    this.toggleMenu(false);
    if (!media) return;
    void media.setRate(rate).then((ok) => {
      if (ok) this.rate = rate;
      else this.rateLocked = true;
      this.renderChrome();
    });
  }

  private toggleMenu(open = !this.menuOpen) {
    this.menuOpen = open;
    this.renderChrome();
    if (open) this.chrome.querySelector<HTMLButtonElement>(".menu button")?.focus();
  }

  private fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (this.requestFullscreen) void this.requestFullscreen().catch(() => this.media?.nativeFullscreen?.());
    else void this.media?.nativeFullscreen?.().catch(() => {});
  };

  private replay = () => {
    const media = this.media;
    if (!media) return;
    this.s.last = 0;
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
    if (phase !== "playing" && phase !== "paused") this.menuOpen = false;
    this.render();
  }

  private cta(): HTMLAnchorElement | null {
    const href = this.getAttribute("cta-href");
    if (!href) return null;
    let target = href;
    if (!href.startsWith("#")) {
      // Carry the landing page's utm_* to the next page, never to another origin.
      try {
        const url = new URL(href, location.href);
        if (url.origin === location.origin) {
          const here = new URLSearchParams(location.search);
          for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
            const val = here.get(k);
            if (val && !url.searchParams.has(k)) url.searchParams.set(k, val);
          }
          target = url.pathname + url.search + url.hash;
        }
      } catch {
        // Leave the href as written.
      }
    }
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
    const exitPoster = phase === "paused" ? this.getAttribute("exit-poster") : null;
    const want = exitPoster ?? this.posterSrc;
    if (want && this.poster.getAttribute("src") !== want) this.poster.src = want;
    this.poster.hidden = !(phase === "idle" || phase === "resume" || phase === "loading" || exitPoster);
    const nodes: Node[] = [];

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
          el("p", {}, t.resumeTitle),
          el(
            "div",
            { class: "actions" },
            this.button(`${t.resumeContinue} (${mmss(at)})`, () => this.start({ sound: true, at, resumed: true })),
            this.button(t.resumeRestart, () => this.start({ sound: true, at: 0, resumed: false }), "btn ghost"),
          ),
        ),
      );
    }
    if (phase === "muted") {
      const b = el(
        "button",
        { type: "button", class: "unmute", "aria-label": `${t.started}. ${t.unmute}` },
        el(
          "span",
          { class: "card" },
          icon("speaker"),
          el("span", { class: "title" }, this.getAttribute("unmute-title") ?? t.started),
          el("span", { class: "sub" }, this.getAttribute("unmute-text") ?? t.unmute),
        ),
      );
      b.addEventListener("click", this.unmute);
      nodes.push(b);
    }
    if ((phase === "playing" || phase === "paused") && this.controllable) {
      const surface = el("button", { type: "button", class: "surface", "aria-label": phase === "playing" ? t.pause : t.resume });
      surface.addEventListener("click", this.toggle);
      nodes.push(surface);
    }
    if (phase === "paused") {
      const cta = unlocked ? this.cta() : null;
      nodes.push(
        el(
          "div",
          { class: "panel" },
          el("p", {}, t.paused),
          el("div", { class: "actions" }, this.button(t.resumeContinue, this.toggle), ...(cta ? [cta] : [])),
        ),
      );
    }
    if (phase === "ended") {
      const cta = this.cta();
      const again = this.controllable ? [this.button(t.replay, this.replay, "btn ghost")] : [];
      nodes.push(el("div", { class: "panel" }, el("div", { class: "actions" }, ...(cta ? [cta] : []), ...again)));
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
    if (phase === "playing" && unlocked) {
      const cta = this.cta();
      if (cta) nodes.push(el("div", { class: this.controllable ? "cta" : "cta bare" }, cta));
    }

    this.layer.replaceChildren(...nodes);
    this.renderChrome();
    this.paintProgress();
  }

  /**
   * The control bar, only once sound is on: the muted preview shows the
   * unmute card alone, with no bar that looks like minutes already missed.
   */
  private renderChrome() {
    const t = this.t;
    const show = (this.phase === "playing" || this.phase === "paused") && this.controllable;
    this.chrome.hidden = !show;
    this.rail.hidden = !show;
    this.chrome.classList.toggle("open", this.menuOpen);
    if (!show) {
      this.timeLabel = null;
      this.chrome.replaceChildren();
      return;
    }
    const playing = this.phase === "playing";
    this.timeLabel = el("span", { class: "time", "aria-hidden": "true" }, clock(this.time));
    const full = document.fullscreenElement === this;

    const settings = el("div", { class: "group" });
    const speeds = readSpeeds(this);
    if (speeds.length > 0 && !this.rateLocked) {
      const gear = this.ctl("settings", t.settings, () => this.toggleMenu());
      gear.setAttribute("aria-expanded", String(this.menuOpen));
      gear.setAttribute("aria-haspopup", "true");
      const menu = el("div", { class: "menu", role: "group", "aria-label": t.speed }, el("h3", {}, t.speed));
      menu.hidden = !this.menuOpen;
      for (const r of speeds) {
        const item = this.button(el("span", {}, r === 1 ? t.normal : `${r}×`), () => this.setRate(r), "");
        item.append(icon("check"));
        item.setAttribute("aria-pressed", String(r === this.rate));
        menu.append(item);
      }
      settings.append(menu, gear);
    }
    settings.append(this.ctl(full ? "minimize" : "maximize", full ? t.exitFullscreen : t.fullscreen, this.fullscreen));

    this.chrome.replaceChildren(
      el(
        "div",
        { class: "controls" },
        el("div", { class: "group wide" }, this.ctl(playing ? "pause" : "play", playing ? t.pause : t.resume, this.toggle)),
        el(
          "div",
          { class: "group" },
          this.ctl("rewind10", t.rewind, this.rewind),
          this.ctl(this.muted ? "muted" : "volume", this.muted ? t.soundOn : t.mute, this.toggleSound),
          this.timeLabel,
        ),
        el("span", { style: "flex:1" }),
        settings,
      ),
    );
  }

  private paintProgress() {
    const d = this.duration;
    const curve = Number(this.getAttribute("bar-curve")) || BAR_CURVE;
    this.style.setProperty("--kw-p", String(displayProgress(this.time, d, curve)));
    if (this.timeLabel) this.timeLabel.textContent = clock(this.time);
    if (d > 0) {
      this.rail.setAttribute("aria-valuenow", String(Math.round((Math.min(this.time, d) / d) * 100)));
      this.rail.setAttribute("aria-valuetext", `${mmss(this.time)} ${this.t.of} ${mmss(d)}`);
    }
  }

  // ------------------------------------------------------------ reporting

  private emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(`keepwatch:${name}`, {
        bubbles: true,
        composed: true,
        detail: { video: this.video, variant: this.variant?.id, time: this.time },
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
