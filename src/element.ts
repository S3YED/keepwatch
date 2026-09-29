import VimeoPlayer from "@vimeo/player";
import {
  ctaVisible,
  displayProgress,
  mmss,
  parseTime,
  parseVimeo,
  pickVariant,
  readUtm,
  resumeFrom,
  slug,
  vimeoEmbedUrl,
  vimeoPlainUrl,
  BAR_CURVE,
  type Beat,
  type Variant,
} from "./core.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { claimAudio, installGateStyle, load, onAudioClaimed, save, unlockGates } from "./store.ts";
import { CSS } from "./styles.ts";

/**
 * <keep-watch>: a Vidalytics-style player over any Vimeo link.
 *
 *   <keep-watch src="https://vimeo.com/1226915932" cta-at="6:11"
 *               cta-href="#book" collect="https://getclark.app/api/vsl"></keep-watch>
 *
 * Attributes
 *   src         Vimeo link or id (public, or unlisted with its hash).
 *   variants    A/B instead of src: JSON [{"id":"a","src":"…","weight":1}, …].
 *   video       Analytics id for this video. Default: "vimeo-<id>" of the first variant.
 *   cta-at      When the CTA appears ("6:11", "371"). Omit for no timed CTA.
 *   cta-href    Where the CTA goes. "#id" scrolls; anything else navigates, carrying utm_*.
 *   cta-text    CTA label. Default per language ("Book your call").
 *   cta-target  "_blank" to open the CTA in a new tab.
 *   autoplay    "load" (default): muted autoplay at once. "inview": when half on screen.
 *               "click": with sound at once (use after a click, e.g. in a modal).
 *               "none": poster and play button only.
 *   collect     Analytics endpoint. Omit to send nothing.
 *   placement   Where the player sits on the site, for the dashboard. Default "main".
 *   poster      Poster image URL. Default: Vimeo's thumbnail.
 *   lang        en | nl | ru. Default: the page's <html lang>.
 *   label       Accessible name of the video (iframe title). Default "Video".
 *   bar-curve   How far ahead the bar runs. 1 is honest, 2.2 default, higher is faster early.
 *
 * Page hooks
 *   [data-keepwatch-gate]  hidden until the CTA unlocks (or the video fails to load).
 *   Events (bubble, composed; detail {video, variant, time}): keepwatch:ready,
 *   keepwatch:play, keepwatch:unmute, keepwatch:pause, keepwatch:cta-shown,
 *   keepwatch:cta-click, keepwatch:ended, keepwatch:error.
 *
 * Until it starts, the frame is a poster and no player iframe exists.
 */

type Phase = "idle" | "resume" | "loading" | "muted" | "playing" | "paused" | "ended" | "error";
type Mode = "load" | "inview" | "click" | "none";

const BEAT_EVERY_SEC = 30;
const LOAD_TIMEOUT_MS = 15_000;

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
          const parsed = typeof v.src === "string" ? parseVimeo(v.src) : null;
          if (!parsed) continue;
          out.push({
            id: slug(typeof v.id === "string" ? v.id : `vimeo-${parsed.vimeoId}`) || `vimeo-${parsed.vimeoId}`,
            weight: typeof v.weight === "number" && v.weight >= 0 ? v.weight : 1,
            ...parsed,
          });
        }
        return out;
      }
    } catch {
      console.error("[keepwatch] `variants` is not valid JSON");
    }
  }
  const parsed = parseVimeo(host.getAttribute("src") ?? "");
  return parsed ? [{ id: `vimeo-${parsed.vimeoId}`, weight: 1, ...parsed }] : [];
}

export class KeepWatchElement extends HTMLElement {
  static observedAttributes = ["src", "variants"];

  private root: ShadowRoot;
  private layer: HTMLDivElement;
  private fill: HTMLDivElement;
  private rail: HTMLDivElement;
  private bar: HTMLDivElement;
  private poster: HTMLImageElement;
  private iframe: HTMLIFrameElement | null = null;
  private player: VimeoPlayer | null = null;
  private cleanups: (() => void)[] = [];

  private t: Strings = stringsFor("en").t;
  private locale = "en";
  private variant: Variant | null = null;
  private video = "";
  private duration = 0;
  private phase: Phase = "idle";
  private time = 0;
  private muted = true;
  private resumeAt: number | null = null;
  private loadTimer = 0;

  private s = {
    sid: "",
    started: false,
    audible: false,
    restartOnUnmute: false,
    autoBlocked: false,
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
  };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = CSS;
    this.poster = el("img", { class: "poster", alt: "", decoding: "async" });
    this.layer = el("div");
    this.fill = el("div", { class: "fill" });
    this.rail = el("div", { class: "rail", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, this.fill);
    this.bar = el("div", { class: "bar" });
    this.root.append(style, this.poster, this.layer, this.bar, this.rail);
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

  private init() {
    ({ lang: this.locale, t: this.t } = stringsFor(this.getAttribute("lang") ?? document.documentElement.lang));
    const variants = readVariants(this);
    if (variants.length === 0) {
      console.error("[keepwatch] needs a Vimeo `src` or `variants`");
      return;
    }
    this.video = slug(this.getAttribute("video") ?? "") || variants[0].id;
    const saved = load(this.video);
    this.variant = pickVariant(variants, saved.variant, Math.random());
    if (!this.variant) return;
    save(this.video, { variant: this.variant.id });
    if (ctaVisible(saved.furthest, this.ctaAt)) unlockGates();

    this.s = { ...this.s, sid: sessionId(), started: false, furthest: 0, watched: 0, beatAtWatched: 0 };
    this.cleanups.push(onAudioClaimed(this, () => this.player?.pause().catch(() => {})));
    this.fetchMeta();
    this.setPhase("idle");
    this.emit("ready");

    const onHide = () => {
      if (document.visibilityState === "hidden") this.beat(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    this.cleanups.push(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    });

    const mode = (this.getAttribute("autoplay") ?? "load") as Mode;
    if (mode === "click") this.begin("click");
    else if (mode === "none" || prefersNoAutoplay()) return;
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

  private teardown() {
    window.clearTimeout(this.loadTimer);
    for (const c of this.cleanups.splice(0)) c();
    this.player?.destroy().catch(() => {});
    this.player = null;
    this.iframe?.remove();
    this.iframe = null;
  }

  /** Poster and duration from Vimeo's oEmbed, unless the page gave a poster. */
  private fetchMeta() {
    const v = this.variant;
    if (!v) return;
    const poster = this.getAttribute("poster");
    if (poster) this.poster.src = poster;
    const page = `https://vimeo.com/${v.vimeoId}${v.hash ? `/${v.hash}` : ""}`;
    fetch(`https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(page)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: { thumbnail_url?: string; duration?: number } | null) => {
        if (!meta) return;
        if (!poster && meta.thumbnail_url) this.poster.src = meta.thumbnail_url;
        if (!this.duration && typeof meta.duration === "number") this.duration = meta.duration;
      })
      .catch(() => {
        // No poster: the frame stays black until the video starts.
      });
  }

  // ------------------------------------------------------------ lifecycle

  private begin(trigger: "auto" | "click") {
    const v = this.variant;
    if (!v) return;
    const at = resumeFrom(load(this.video).pos, this.duration || Number.POSITIVE_INFINITY);
    if (at !== null) {
      this.resumeAt = at;
      this.setPhase("resume");
      return;
    }
    this.start({ audible: trigger === "click", at: 0, resumed: false });
  }

  private start(opts: { audible: boolean; at: number; resumed: boolean }) {
    const v = this.variant;
    if (!v) return;
    const s = this.s;
    s.audible = opts.audible;
    s.restartOnUnmute = !opts.audible;
    s.startAt = opts.at;
    s.last = opts.at;
    s.resumed = s.resumed || opts.resumed;
    this.muted = !opts.audible;
    this.time = opts.at;
    this.setPhase("loading");

    this.player?.destroy().catch(() => {});
    this.iframe?.remove();
    const iframe = el("iframe", {
      class: "iframe",
      src: vimeoEmbedUrl(v, { muted: !opts.audible, autoplay: !opts.audible && opts.at === 0 }),
      allow: "autoplay; fullscreen; picture-in-picture",
      allowfullscreen: "",
      title: this.getAttribute("label") ?? "Video",
    });
    this.iframe = iframe;
    this.root.insertBefore(iframe, this.poster);
    this.loadTimer = window.setTimeout(() => {
      if (!s.started) this.fail();
    }, LOAD_TIMEOUT_MS);
    void this.attach(iframe);
  }

  private async attach(iframe: HTMLIFrameElement) {
    const v = this.variant!;
    const s = this.s;
    const player = new VimeoPlayer(iframe);
    this.player = player;

    const onPlay = () => {
      window.clearTimeout(this.loadTimer);
      if (!s.started) {
        s.started = true;
        this.beat();
      }
      const next = s.audible ? "playing" : "muted";
      // Vimeo can report one start twice (the event, and our own check below).
      if (this.phase === next) return;
      this.setPhase(next);
      this.emit("play");
    };
    player.on("play", onPlay);
    player.on("pause", () => {
      if (this.phase === "playing") {
        this.setPhase("paused");
        this.emit("pause");
      }
    });
    player.on("ended", () => {
      s.completed = true;
      save(this.video, { pos: this.duration });
      this.setPhase("ended");
      this.beat();
      this.emit("ended");
    });
    player.on("error", () => this.fail());
    player.on("timeupdate", ({ seconds, duration }: { seconds: number; duration: number }) => this.tick(seconds, duration));

    player
      .getDuration()
      .then((d) => {
        if (d > 0) this.duration = d;
      })
      .catch(() => {});

    if (!s.audible) {
      // Muted autoplay may have started before these listeners existed, and
      // some browsers (iOS Low Power Mode) refuse even muted autoplay. The
      // first counts as the play; the second falls back to the play button.
      const paused = await player.getPaused().catch(() => true);
      if (this.player !== player) return;
      if (!paused) onPlay();
      else {
        await player.play().catch(() => {
          if (s.started || this.player !== player) return;
          s.autoBlocked = true;
          window.clearTimeout(this.loadTimer);
          this.teardownPlayer();
          this.setPhase("idle");
        });
      }
      return;
    }

    // A start with sound: seek (resume), then play. If the browser refuses
    // sound, fall back to muted playback with the unmute overlay.
    try {
      if (s.startAt > 0) await player.setCurrentTime(s.startAt);
      await player.setVolume(1);
      await player.play();
      s.unmuted = true;
      claimAudio(this);
      this.emit("unmute");
    } catch {
      s.audible = false;
      s.restartOnUnmute = s.startAt === 0;
      this.muted = true;
      await player.setMuted(true).catch(() => {});
      await player.play().catch(() => this.fail());
    }
  }

  private teardownPlayer() {
    this.player?.destroy().catch(() => {});
    this.player = null;
    this.iframe?.remove();
    this.iframe = null;
  }

  private tick(seconds: number, duration: number) {
    const v = this.variant!;
    const s = this.s;
    if (duration > 0) this.duration = duration;
    this.time = seconds;
    this.paintProgress();
    if (!s.audible) return;
    const delta = seconds - s.last;
    if (delta > 0 && delta < 1.5) s.watched += delta;
    s.last = seconds;
    s.furthest = Math.max(s.furthest, Math.floor(seconds));
    if (seconds - s.savedAt >= 2 || seconds < s.savedAt) {
      s.savedAt = seconds;
      save(this.video, { variant: v.id, pos: seconds });
    }
    if (!s.ctaShown && ctaVisible(Math.max(s.furthest, load(this.video).furthest), this.ctaAt)) {
      s.ctaShown = true;
      unlockGates();
      this.render();
      this.beat();
      this.emit("cta-shown");
    }
    if (s.watched - s.beatAtWatched >= BEAT_EVERY_SEC) {
      s.beatAtWatched = s.watched;
      this.beat();
    }
  }

  private fail() {
    unlockGates();
    this.setPhase("error");
    this.emit("error");
  }

  // -------------------------------------------------------------- actions

  private unmute = () => {
    const p = this.player;
    if (!p) return;
    const s = this.s;
    const restart = s.restartOnUnmute;
    s.restartOnUnmute = false;
    s.audible = true;
    s.unmuted = true;
    if (restart) s.last = 0;
    this.muted = false;
    claimAudio(this);
    // Switch the view now; Vimeo's play/pause events keep it honest after.
    this.setPhase("playing");
    this.beat();
    this.emit("unmute");
    void (async () => {
      if (restart) await p.setCurrentTime(0).catch(() => {});
      await p.setMuted(false).catch(() => {});
      await p.setVolume(1).catch(() => {});
      await p.play().catch(() => {});
    })();
  };

  private toggle = () => {
    const p = this.player;
    if (!p) return;
    if (this.phase === "playing") p.pause().catch(() => {});
    else if (this.phase === "paused") {
      claimAudio(this);
      p.play().catch(() => {});
    }
  };

  private toggleSound = () => {
    const p = this.player;
    if (!p) return;
    this.muted = !this.muted;
    this.s.audible = !this.muted;
    if (!this.muted) claimAudio(this);
    p.setMuted(this.muted).catch(() => {});
    this.renderBar();
  };

  private fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (this.requestFullscreen) this.requestFullscreen().catch(() => this.player?.requestFullscreen());
    else this.player?.requestFullscreen().catch(() => {});
  };

  private replay = () => {
    const p = this.player;
    if (!p) return;
    this.s.last = 0;
    claimAudio(this);
    void p.setCurrentTime(0).then(() => p.play()).catch(() => {});
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
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  };

  // ------------------------------------------------------------ rendering

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.setAttribute("data-phase", phase);
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

  private button(label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
    const b = el("button", { type: "button", class: cls }, label);
    b.addEventListener("click", onClick);
    return b;
  }

  private render() {
    const t = this.t;
    const phase = this.phase;
    const unlocked = ctaVisible(Math.max(this.s.furthest, load(this.video).furthest), this.ctaAt);
    this.poster.hidden = !(phase === "idle" || phase === "resume" || phase === "loading");
    const nodes: Node[] = [];

    if (phase === "idle") {
      const facade = el(
        "button",
        { type: "button", class: "facade", "aria-label": t.play },
        el("span", { class: "play", "aria-hidden": "true" }, "▶"),
        el("span", { class: "label" }, t.play),
      );
      facade.addEventListener("click", () => this.begin("click"));
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
            { class: "row" },
            this.button(`${t.resumeContinue} (${mmss(at)})`, () => this.start({ audible: true, at, resumed: true })),
            this.button(t.resumeRestart, () => this.start({ audible: true, at: 0, resumed: false }), "btn ghost"),
          ),
        ),
      );
    }
    if (phase === "muted") {
      const b = el(
        "button",
        { type: "button", class: "unmute" },
        el(
          "span",
          { class: "card" },
          el("span", { class: "icon", "aria-hidden": "true" }, "🔇"),
          el("span", { class: "title" }, t.started),
          el("span", { class: "sub" }, t.unmute),
        ),
      );
      b.addEventListener("click", this.unmute);
      nodes.push(b);
    }
    if (phase === "playing" || phase === "paused") {
      const surface = el("button", {
        type: "button",
        class: "surface",
        "aria-label": phase === "playing" ? t.pause : t.resume,
      });
      surface.addEventListener("click", this.toggle);
      nodes.push(surface);
    }
    if (phase === "paused") {
      const cta = unlocked ? this.cta() : null;
      nodes.push(
        el("div", { class: "panel" }, el("p", {}, t.paused), el("div", { class: "row" }, this.button(t.resumeContinue, this.toggle), ...(cta ? [cta] : []))),
      );
    }
    if (phase === "ended") {
      const cta = this.cta();
      nodes.push(el("div", { class: "panel" }, el("div", { class: "row" }, ...(cta ? [cta] : []), this.button(t.replay, this.replay, "btn ghost"))));
    }
    if (phase === "error" && this.variant) {
      const open = el("a", { class: "btn ghost", href: vimeoPlainUrl(this.variant), target: "_blank", rel: "noopener" }, t.openVimeo);
      const cta = this.cta();
      nodes.push(el("div", { class: "panel" }, el("p", {}, t.error), el("div", { class: "row" }, open, ...(cta ? [cta] : []))));
    }
    if (phase === "playing" && unlocked) {
      const cta = this.cta();
      if (cta) nodes.push(el("div", { class: "cta" }, cta));
    }

    this.layer.replaceChildren(...nodes);
    this.renderBar();
    this.paintProgress();
  }

  private renderBar() {
    const t = this.t;
    const show = this.phase === "playing" || this.phase === "paused";
    this.bar.hidden = !show;
    this.rail.hidden = !(show || this.phase === "muted");
    if (!show) return;
    this.bar.replaceChildren(
      this.button(this.phase === "playing" ? "❚❚" : "▶", this.toggle, "ctl"),
      this.button(this.muted ? "🔇" : "🔊", this.toggleSound, "ctl"),
      el("span", { class: "spacer" }),
      this.button("⛶", this.fullscreen, "ctl"),
    );
    const [pp, snd, , fs] = Array.from(this.bar.children);
    pp.setAttribute("aria-label", this.phase === "playing" ? t.pause : t.resume);
    snd.setAttribute("aria-label", this.muted ? t.soundOn : t.mute);
    fs.setAttribute("aria-label", t.fullscreen);
  }

  private paintProgress() {
    const d = this.duration;
    const curve = Number(this.getAttribute("bar-curve")) || BAR_CURVE;
    this.style.setProperty("--kw-p", String(displayProgress(this.time, d, curve)));
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
