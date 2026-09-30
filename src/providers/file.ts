import type { Provider } from "./types.ts";

/* hls.js, if the page loaded it: <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script> */
type HlsCtor = {
  new (): { loadSource(url: string): void; attachMedia(v: HTMLVideoElement): void; destroy(): void; on(e: string, cb: (e: unknown, d: { fatal?: boolean }) => void): void };
  isSupported(): boolean;
  Events: { ERROR: string };
};

/**
 * A plain <video>: MP4, WebM, MOV, and HLS (.m3u8). Covers self-hosting and
 * any host that hands out file or HLS URLs (Bunny Stream, Cloudflare Stream,
 * Mux, S3). HLS plays natively in Safari and current Chrome; elsewhere it
 * uses hls.js when the page has loaded it.
 */
export const file: Provider = {
  id: "file",
  controllable: true,

  mount(host, source, opts, on) {
    const video = document.createElement("video");
    video.className = "media";
    video.playsInline = true;
    video.preload = "auto";
    video.muted = opts.muted;
    video.defaultMuted = opts.muted;
    video.setAttribute("aria-label", opts.label);
    host.append(video);

    let hls: InstanceType<HlsCtor> | null = null;
    const isHls = /\.m3u8(\?|#|$)/i.test(source.id);
    const Hls = (window as Window & { Hls?: HlsCtor }).Hls;
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) video.src = source.id;
    else if (Hls?.isSupported()) {
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) on.error("hls");
      });
      hls.loadSource(source.id);
      hls.attachMedia(video);
    } else {
      queueMicrotask(() => on.error("hls-unsupported"));
    }

    let started = false;
    video.addEventListener("loadedmetadata", () => {
      if (opts.startAt > 0) video.currentTime = opts.startAt;
      on.ready(Number.isFinite(video.duration) ? video.duration : 0);
      if (!started) {
        started = true;
        video.play().catch(() => {
          // Refused autoplay: the shell notices the video stays paused.
        });
      }
    });
    video.addEventListener("play", () => on.play());
    video.addEventListener("pause", () => {
      if (!video.ended) on.pause();
    });
    video.addEventListener("ended", () => on.ended());
    video.addEventListener("timeupdate", () => on.time(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0));
    video.addEventListener("error", () => on.error(`file-${video.error?.code ?? 0}`));

    const iosVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    return {
      play: () => video.play(),
      pause: async () => video.pause(),
      seek: async (s) => {
        video.currentTime = s;
      },
      setMuted: async (muted) => {
        video.muted = muted;
        if (!muted) video.volume = 1;
      },
      isMuted: async () => video.muted || video.volume === 0,
      setRate: async (rate) => {
        video.playbackRate = rate;
        return true;
      },
      nativeFullscreen: async () => iosVideo.webkitEnterFullscreen?.(),
      destroy: () => {
        hls?.destroy();
        video.removeAttribute("src");
        video.load();
        video.remove();
      },
    };
  },
};
