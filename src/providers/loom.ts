import type { Provider } from "./types.ts";

/**
 * Loom has no public player API: no play/pause/mute commands and no time
 * events. So Loom is `controllable: false`. The shell shows the poster, and
 * on click mounts Loom's own player with sound and Loom's own controls. The
 * view and the play are measured; watch time and drop-off are not, and a
 * timed CTA runs on the clock since the click.
 */
export const loom: Provider = {
  id: "loom",
  controllable: false,

  async meta(source) {
    const page = `https://www.loom.com/share/${source.id}`;
    const res = await fetch(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(page)}`);
    if (!res.ok) return null;
    const meta = (await res.json()) as { thumbnail_url?: unknown; duration?: unknown };
    return {
      poster: typeof meta.thumbnail_url === "string" ? meta.thumbnail_url : undefined,
      duration: typeof meta.duration === "number" ? meta.duration : undefined,
    };
  },

  mount(host, source, opts, on) {
    const params = new URLSearchParams({
      autoplay: "1",
      hide_owner: "true",
      hide_share: "true",
      hide_title: "true",
      hideEmbedTopBar: "true",
    });
    if (opts.muted) params.set("muted", "true");
    const at = Math.floor(opts.startAt);
    if (at > 0) params.set("t", `${at}s`);
    const iframe = document.createElement("iframe");
    iframe.className = "media";
    iframe.src = `https://www.loom.com/embed/${source.id}?${params}`;
    iframe.allow = "autoplay; fullscreen";
    iframe.title = opts.label;
    iframe.addEventListener(
      "load",
      () => {
        on.ready(0);
        on.play();
      },
      { once: true },
    );
    host.append(iframe);

    const none = async () => {};
    return {
      play: none,
      pause: none,
      seek: none,
      setMuted: none,
      isMuted: async () => false,
      setRate: async () => false,
      destroy: () => iframe.remove(),
    };
  },
};
