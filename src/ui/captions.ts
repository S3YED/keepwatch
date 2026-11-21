import { captionLines, parseVtt, type CaptionTrack, type Cue } from "../vtt.ts";
import { el, fetchText } from "./dom.ts";

/**
 * The captions overlay. Cues come from a WebVTT file the player fetches and
 * parses itself, and are shown by the player's own clock, so they work the
 * same over a <video> and over a Vimeo or YouTube iframe.
 *
 * Cue text is set with text nodes only. Nothing from the file is ever parsed
 * as HTML.
 */
export class CaptionsView {
  readonly el: HTMLDivElement;
  private cues: readonly Cue[] = [];
  private shown = "";
  private time = 0;
  /** Guards a slow download against a newer choice. */
  private request = 0;
  private files = new Map<string, Promise<readonly Cue[]>>();

  constructor() {
    this.el = el("div", { class: "captions", part: "captions" });
    this.el.hidden = true;
  }

  /** Show this track, or none. The file is fetched once per page. */
  select(track: CaptionTrack | null) {
    const mine = ++this.request;
    this.cues = [];
    this.draw([]);
    if (!track) return;
    if (track.lang) this.el.lang = track.lang;
    else this.el.removeAttribute("lang");
    let file = this.files.get(track.url);
    if (!file) {
      file = fetchText(track.url, "captions").then(parseVtt);
      this.files.set(track.url, file);
    }
    void file.then((cues) => {
      if (mine !== this.request) return;
      this.cues = cues;
      this.update(this.time);
    });
  }

  /** The player's clock moved. */
  update(time: number) {
    this.time = time;
    if (this.cues.length) this.draw(captionLines(this.cues, time));
  }

  private draw(lines: readonly string[]) {
    const key = lines.join("\n");
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = lines.length === 0;
    this.el.replaceChildren(...lines.map((line) => el("span", { class: "cue" }, line)));
  }
}
