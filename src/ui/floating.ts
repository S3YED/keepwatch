import { inViewNext, miniSize, visibleShare, type Corner } from "../mini.ts";

/**
 * Carries out the mini player (the decisions are in mini.ts).
 *
 * The <keep-watch> element never moves: it stays in the page as the
 * placeholder, with its own box, so nothing on the page jumps. What floats is
 * the frame inside its shadow root, which holds the video and the controls.
 * The frame is not re-parented either, because moving an iframe reloads it,
 * and a reload would be a second playback. It is only re-positioned.
 *
 * Where the browser has the Popover API the frame goes into the top layer,
 * which no ancestor's `transform`, `overflow` or `z-index` can clip or cover.
 * Elsewhere it is `position: fixed` with a high `z-index`.
 */
export class Floater {
  floating = false;
  inView = true;
  private topLayer = false;
  private corner: Corner | null = null;
  private asked: number | null = null;

  constructor(
    private host: HTMLElement,
    private frame: HTMLElement,
    /** The player came into or went out of view. */
    private onView: () => void,
  ) {}

  /** Start watching the player's place in the page. Returns the cleanup. */
  watch(): () => void {
    if (typeof IntersectionObserver !== "function") return () => {};
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        const root = e.rootBounds ?? { width: window.innerWidth, height: window.innerHeight };
        const next = inViewNext(this.inView, visibleShare(e.intersectionRect, e.boundingClientRect, root));
        if (next === this.inView) return;
        this.inView = next;
        this.onView();
      },
      { threshold: [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );
    io.observe(this.host);
    const onResize = () => {
      if (this.floating) this.size();
    };
    window.addEventListener("resize", onResize);
    return () => {
      io.disconnect();
      window.removeEventListener("resize", onResize);
      this.unfloat();
      this.inView = true;
    };
  }

  float(corner: Corner, width: number | null) {
    this.corner = corner;
    this.asked = width;
    this.size();
    this.host.setAttribute("data-mini", corner);
    if (this.floating) return;
    this.floating = true;
    const frame = this.frame as HTMLElement & { showPopover?: () => void };
    if (typeof frame.showPopover === "function") {
      try {
        frame.setAttribute("popover", "manual");
        frame.showPopover();
        this.topLayer = true;
      } catch {
        // Not allowed here (a detached or inert tree): fixed positioning still floats it.
        frame.removeAttribute("popover");
        this.topLayer = false;
      }
    }
  }

  unfloat() {
    if (!this.floating) return;
    this.floating = false;
    const frame = this.frame as HTMLElement & { hidePopover?: () => void };
    if (this.topLayer) {
      try {
        frame.hidePopover?.();
      } catch {
        // Already closed.
      }
      this.topLayer = false;
    }
    frame.removeAttribute("popover");
    this.host.removeAttribute("data-mini");
    frame.style.removeProperty("--_mini-w");
    frame.style.removeProperty("--_mini-h");
  }

  /** The floating size follows the window, and keeps the player's own shape. */
  private size() {
    if (!this.corner) return;
    const box = this.host.getBoundingClientRect();
    const ratio = box.width > 0 && box.height > 0 ? box.width / box.height : 16 / 9;
    const { width, height } = miniSize(this.asked, { width: window.innerWidth, height: window.innerHeight }, ratio);
    this.frame.style.setProperty("--_mini-w", `${width}px`);
    this.frame.style.setProperty("--_mini-h", `${height}px`);
  }
}
