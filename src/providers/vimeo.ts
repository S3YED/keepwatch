import VimeoPlayer from "@vimeo/player";
import type { Source } from "../sources.ts";
import type { Provider } from "./types.ts";

/**
 * The embed URL for our own chrome: Vimeo's controls, title and byline off,
 * `dnt=1` so Vimeo does not track viewers (no consent gate needed). Always
 * autoplay: the shell decides muted or not, and a resume starts at `#t=`.
 */
export function vimeoEmbedUrl(source: Source, opts: { muted: boolean; startAt: number }): string {
  const params = new URLSearchParams({
    dnt: "1",
    controls: "0",
    autoplay: "1",
    muted: opts.muted ? "1" : "0",
    playsinline: "1",
    autopause: "0",
    title: "0",
    byline: "0",
    portrait: "0",
    keyboard: "0",
    speed: "1",
  });
  if (source.hash) params.set("h", source.hash);
  const at = Math.floor(opts.startAt);
  return `https://player.vimeo.com/video/${source.id}?${params}${at > 0 ? `#t=${at}s` : ""}`;
}

export const vimeo: Provider = {
  id: "vimeo",
  controllable: true,

  async meta(source) {
    const page = `https://vimeo.com/${source.id}${source.hash ? `/${source.hash}` : ""}`;
    const res = await fetch(`https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(page)}`);
    if (!res.ok) return null;
    const meta = (await res.json()) as { thumbnail_url?: unknown; duration?: unknown };
    return {
      poster: typeof meta.thumbnail_url === "string" ? meta.thumbnail_url : undefined,
      duration: typeof meta.duration === "number" ? meta.duration : undefined,
    };
  },

  mount(host, source, opts, on) {
    const iframe = document.createElement("iframe");
    iframe.className = "media";
    iframe.src = vimeoEmbedUrl(source, opts);
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    iframe.title = opts.label;
    host.append(iframe);

    const player = new VimeoPlayer(iframe);
    let duration = 0;
    player.on("play", () => on.play());
    player.on("pause", () => on.pause());
    player.on("ended", () => on.ended());
    player.on("timeupdate", (e: { seconds: number; duration: number }) => {
      if (e.duration > 0) duration = e.duration;
      on.time(e.seconds, duration);
    });
    player.on("error", (e: { name?: string }) => {
      // A refused autoplay is not a broken video: the shell handles it.
      if (e?.name === "NotAllowedError") return;
      on.error(e?.name ?? "vimeo");
    });
    player
      .ready()
      .then(() => player.getDuration().catch(() => 0))
      .then((d) => {
        duration = d;
        on.ready(d);
      })
      .catch(() => on.error("vimeo-load"));

    return {
      play: () => player.play().then(() => {}),
      pause: () => player.pause().then(() => {}),
      seek: (s) => player.setCurrentTime(s).then(() => {}),
      setMuted: async (muted) => {
        await player.setMuted(muted);
        if (!muted) await player.setVolume(1);
      },
      isMuted: async () => (await player.getMuted()) || (await player.getVolume()) === 0,
      setRate: (rate) => player.setPlaybackRate(rate).then(() => true, () => false),
      nativeFullscreen: () => player.requestFullscreen().then(() => {}),
      destroy: () => {
        player.destroy().catch(() => {});
        iframe.remove();
      },
    };
  },
};
