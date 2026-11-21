import { seekFromPointer, seekKey } from "../bar.ts";
import { el } from "./dom.ts";

/**
 * The progress rail. By default a display (`role="progressbar"`): the fill,
 * plus chapter marks. With a seekable linear bar it becomes a slider: drag
 * with a pointer or a finger, or use the arrow keys, Page Up/Down, Home and
 * End. All maths is in bar.ts; this only wires events to it.
 */

export type RailHooks = {
  /** The viewer chose a time. */
  seek(to: number): void;
  /** What to show for a time: the tooltip while hovering or dragging ("1:20 · Demo"). */
  describe(time: number): string;
  /** Keep the controls awake while the viewer is on the bar. */
  wake(): void;
};

export type RailPaint = {
  time: number;
  duration: number;
  /** `aria-valuetext`: "1:20 of 7:46", with the chapter when there is one. */
  text: string;
};

export class Rail {
  readonly el: HTMLDivElement;
  private marksEl: HTMLDivElement;
  private tip: HTMLDivElement;
  private seekable = false;
  private time = 0;
  private duration = 0;
  /** The time under the pointer while dragging; null otherwise. */
  private scrub: number | null = null;
  private marksKey = "";

  constructor(private hooks: RailHooks) {
    this.marksEl = el("div", { class: "marks" });
    this.tip = el("div", { class: "tip", "aria-hidden": "true" });
    this.tip.hidden = true;
    this.el = el(
      "div",
      { class: "rail", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" },
      el("div", { class: "track" }, el("div", { class: "fill" })),
      this.marksEl,
      el("div", { class: "thumb" }),
      this.tip,
    );
    this.el.addEventListener("pointerdown", this.onDown);
    this.el.addEventListener("pointermove", this.onMove);
    this.el.addEventListener("pointerup", this.onUp);
    this.el.addEventListener("pointercancel", this.onCancel);
    this.el.addEventListener("pointerleave", this.onLeave);
    this.el.addEventListener("keydown", this.onKey);
    this.el.addEventListener("focus", this.onFocus);
    this.el.addEventListener("blur", this.onLeave);
  }

  get hidden(): boolean {
    return this.el.hidden;
  }

  set hidden(hidden: boolean) {
    this.el.hidden = hidden;
    if (hidden) this.endScrub();
  }

  /** Display or slider. `label` is the slider's accessible name. */
  configure(opts: { seekable: boolean; label: string }) {
    if (opts.seekable === this.seekable) {
      if (opts.seekable) this.el.setAttribute("aria-label", opts.label);
      return;
    }
    this.seekable = opts.seekable;
    this.endScrub();
    this.el.classList.toggle("seek", opts.seekable);
    this.el.setAttribute("role", opts.seekable ? "slider" : "progressbar");
    for (const name of ["aria-valuenow", "aria-valuetext"]) this.el.removeAttribute(name);
    if (opts.seekable) {
      this.el.tabIndex = 0;
      this.el.setAttribute("aria-label", opts.label);
      this.el.setAttribute("aria-orientation", "horizontal");
    } else {
      this.el.removeAttribute("tabindex");
      this.el.removeAttribute("aria-label");
      this.el.removeAttribute("aria-orientation");
      this.el.setAttribute("aria-valuemax", "100");
    }
  }

  /** The values assistive technology reads. The fill itself follows `--kw-p` on the player. */
  paint(p: RailPaint) {
    this.time = p.time;
    this.duration = p.duration;
    if (!(p.duration > 0)) return;
    const at = Math.min(Math.max(p.time, 0), p.duration);
    if (this.seekable) {
      // A slider speaks in seconds, so its arrow keys and its value agree.
      this.el.setAttribute("aria-valuemax", String(Math.round(p.duration)));
      this.el.setAttribute("aria-valuenow", String(Math.round(at)));
    } else {
      this.el.setAttribute("aria-valuenow", String(Math.round((at / p.duration) * 100)));
    }
    this.el.setAttribute("aria-valuetext", p.text);
  }

  /** Chapter marks at these positions (0 to 1). */
  marks(positions: readonly number[]) {
    const key = positions.join(",");
    if (key === this.marksKey) return;
    this.marksKey = key;
    this.marksEl.replaceChildren(
      ...positions.map((p) => {
        const mark = el("span", { class: "mark" });
        mark.style.insetInlineStart = `${(p * 100).toFixed(3)}%`;
        return mark;
      }),
    );
  }

  private timeAt(e: PointerEvent): number | null {
    const box = this.el.getBoundingClientRect();
    const rtl = getComputedStyle(this.el).direction === "rtl";
    return seekFromPointer(e.clientX, box.left, box.width, this.duration, rtl);
  }

  /** Show the tooltip over `time`, kept inside the rail. */
  private showTip(time: number) {
    if (!(this.duration > 0)) return;
    this.tip.textContent = this.hooks.describe(time);
    this.tip.hidden = false;
    const width = this.el.clientWidth;
    const half = this.tip.offsetWidth / 2;
    const rtl = getComputedStyle(this.el).direction === "rtl";
    const share = time / this.duration;
    const x = (rtl ? 1 - share : share) * width;
    this.tip.style.left = `${Math.min(Math.max(x, half), Math.max(half, width - half))}px`;
  }

  private endScrub() {
    this.scrub = null;
    this.el.classList.remove("scrubbing");
    this.el.style.removeProperty("--kw-p");
    this.tip.hidden = true;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.seekable || (e.pointerType === "mouse" && e.button !== 0)) return;
    const to = this.timeAt(e);
    if (to === null) return;
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    this.el.classList.add("scrubbing");
    this.setScrub(to);
  };

  private setScrub(to: number) {
    this.scrub = to;
    // While dragging, the fill follows the finger, not the video.
    this.el.style.setProperty("--kw-p", String(to / this.duration));
    this.showTip(to);
    this.hooks.wake();
  }

  private onMove = (e: PointerEvent) => {
    if (!this.seekable) return;
    const to = this.timeAt(e);
    if (to === null) return;
    if (this.scrub !== null) this.setScrub(to);
    else if (e.pointerType === "mouse") this.showTip(to);
  };

  private onUp = (e: PointerEvent) => {
    if (this.scrub === null) return;
    const to = this.timeAt(e) ?? this.scrub;
    this.endScrub();
    if (this.el.hasPointerCapture?.(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.hooks.seek(to);
  };

  private onCancel = () => this.endScrub();

  private onLeave = () => {
    if (this.scrub === null) this.tip.hidden = true;
  };

  private onFocus = () => {
    // Keyboard focus only: a click already shows the tooltip under the pointer.
    if (this.seekable && this.el.matches(":focus-visible")) this.showTip(this.time);
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.seekable || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = seekKey(e.key, this.time, this.duration);
    if (to === null) return;
    e.preventDefault();
    this.hooks.seek(to);
    this.showTip(to);
    this.hooks.wake();
  };
}
