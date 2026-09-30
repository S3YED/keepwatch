import type { Source } from "../sources.ts";

/**
 * The contract between the player shell (element.ts) and a video provider.
 * The shell owns everything the viewer sees: poster, unmute card, controls,
 * CTA, resume, analytics. A provider only mounts the provider's own player
 * inside `host` and drives it. Adding a provider means implementing this and
 * calling `registerProvider`; the shell does not change.
 */

export type MountOptions = {
  /** Start muted. Browsers only autoplay silent video without a click. */
  muted: boolean;
  /** Where to start, in seconds (a resume). */
  startAt: number;
  /** Accessible name for the provider's iframe or video. */
  label: string;
};

export type MediaEvents = {
  /** The player can take commands. `duration` is 0 when not known yet. */
  ready(duration: number): void;
  play(): void;
  pause(): void;
  ended(): void;
  /** At least every 250ms while playing. */
  time(seconds: number, duration: number): void;
  /** The video cannot play here (removed, private, blocked, unsupported). */
  error(reason: string): void;
};

export interface MediaHandle {
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  /** Whether the provider is actually silent now; browsers may mute an autoplay on their own. */
  isMuted(): Promise<boolean>;
  /** Resolves false when the provider (or the video's plan) does not allow speed changes. */
  setRate(rate: number): Promise<boolean>;
  /** Native fullscreen, for browsers without element fullscreen (iPhone). */
  nativeFullscreen?(): Promise<void>;
  destroy(): void;
}

export type ProviderMeta = { poster?: string; duration?: number };

export interface Provider {
  readonly id: string;
  /** Recognise a link as this provider's. Custom providers need this; built-ins are parsed in sources.ts. */
  parse?(input: string): Source | null;
  /**
   * False when the provider has no player API (Loom): the shell then shows a
   * poster, hands over to the provider's own controls on click, and times the
   * CTA by the clock instead of the video.
   */
  readonly controllable: boolean;
  /** Poster and duration without loading the player. */
  meta?(source: Source): Promise<ProviderMeta | null>;
  mount(host: HTMLElement, source: Source, opts: MountOptions, on: MediaEvents): MediaHandle;
}
