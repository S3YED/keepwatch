import type { Provider } from "./types.ts";

/* The slice of the YouTube IFrame API this adapter uses. */
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  isMuted(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      host?: string;
      width?: string;
      height?: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};
type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

const PLAYING = 1;
const PAUSED = 2;
const ENDED = 0;

let api: Promise<YTNamespace> | null = null;

/** Load YouTube's IFrame API once per page, and keep any handler the page already set. */
function loadApi(): Promise<YTNamespace> {
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const before = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      before?.();
      if (w.YT) resolve(w.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      api = null;
      reject(new Error("youtube-api"));
    };
    document.head.append(script);
  });
  return api;
}

export const youtube: Provider = {
  id: "youtube",
  controllable: true,

  async meta(source) {
    // maxresdefault is missing on some uploads; hqdefault always exists.
    const best = `https://i.ytimg.com/vi/${source.id}/maxresdefault.jpg`;
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 120);
      img.onerror = () => resolve(false);
      img.src = best;
    });
    return { poster: ok ? best : `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg` };
  },

  mount(host, source, opts, on) {
    const slot = document.createElement("div");
    slot.className = "media";
    host.append(slot);
    let player: YTPlayer | null = null;
    let timer = 0;
    let destroyed = false;

    const poll = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (player) on.time(player.getCurrentTime(), player.getDuration());
      }, 250);
    };

    loadApi()
      .then((YT) => {
        if (destroyed) return;
        player = new YT.Player(slot, {
          videoId: source.id,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            mute: opts.muted ? 1 : 0,
            start: Math.floor(opts.startAt),
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            rel: 0,
            playsinline: 1,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              if (!player) return;
              const iframe = player.getIframe();
              iframe.title = opts.label;
              iframe.classList.add("media");
              on.ready(player.getDuration());
              // The API does not always honour playerVars.autoplay: ask once more, explicitly.
              if (opts.muted) player.mute();
              player.playVideo();
            },
            onStateChange: ({ data }) => {
              if (data === PLAYING) {
                poll();
                on.play();
              } else if (data === PAUSED) {
                window.clearInterval(timer);
                on.pause();
              } else if (data === ENDED) {
                window.clearInterval(timer);
                on.ended();
              }
            },
            // 2 bad id, 5 HTML5 error, 100 removed/private, 101/150 embedding disabled.
            onError: ({ data }) => on.error(`youtube-${data}`),
          },
        });
      })
      .catch(() => on.error("youtube-api"));

    const call = async (fn: (p: YTPlayer) => void) => {
      if (player) fn(player);
    };
    return {
      play: () => call((p) => p.playVideo()),
      pause: () => call((p) => p.pauseVideo()),
      seek: (s) => call((p) => p.seekTo(s, true)),
      setMuted: (muted) =>
        call((p) => {
          if (muted) p.mute();
          else {
            p.unMute();
            p.setVolume(100);
          }
        }),
      isMuted: async () => player?.isMuted() ?? true,
      setRate: async (rate) => {
        if (!player || !player.getAvailablePlaybackRates().includes(rate)) return false;
        player.setPlaybackRate(rate);
        return true;
      },
      destroy: () => {
        destroyed = true;
        window.clearInterval(timer);
        player?.destroy();
        slot.remove();
        host.querySelector("iframe.media")?.remove();
      },
    };
  },
};
