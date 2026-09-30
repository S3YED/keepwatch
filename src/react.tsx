"use client";

import { createElement, useEffect, type CSSProperties, type ReactNode } from "react";

/**
 * React wrapper for <keep-watch>. Safe in server components' trees (Next.js):
 * the element registers in the browser only, on first mount.
 *
 *   <Keepwatch src="https://vimeo.com/1226915932" ctaAt="6:11" ctaHref="#book"
 *              collect="https://getclark.app/api/vsl" />
 *   <KeepwatchGate>…booking section…</KeepwatchGate>
 */

export type KeepwatchProps = {
  /** Vimeo, YouTube or Loom link, or an MP4/WebM/HLS URL. */
  src?: string;
  /** A/B variants: [{ id, src, weight }]. */
  variants?: { id: string; src: string; weight?: number }[];
  video?: string;
  ctaAt?: string;
  ctaHref?: string;
  ctaText?: string;
  ctaTarget?: string;
  autoplay?: "load" | "inview" | "click" | "none";
  collect?: string;
  placement?: string;
  poster?: string;
  lang?: string;
  barCurve?: number;
  /** Settings-menu speeds, e.g. [1, 1.25, 1.5]; [] hides the menu. */
  speeds?: number[];
  /** Loop the muted preview over its first N seconds ("10"). */
  previewLoop?: string;
  unmuteTitle?: string;
  unmuteText?: string;
  exitPoster?: string;
  smartPause?: boolean;
  /** Accessible name of the video. */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

let registering: Promise<unknown> | null = null;

export function Keepwatch(props: KeepwatchProps) {
  useEffect(() => {
    // Through the package name, not "./element.ts": the built react.js must
    // not carry the element, which extends HTMLElement and cannot load on a server.
    registering ??= import("keepwatch").then((m) => m.define());
  }, []);
  const attrs: Record<string, string | undefined> = {
    src: props.src,
    variants: props.variants ? JSON.stringify(props.variants) : undefined,
    video: props.video,
    "cta-at": props.ctaAt,
    "cta-href": props.ctaHref,
    "cta-text": props.ctaText,
    "cta-target": props.ctaTarget,
    autoplay: props.autoplay,
    collect: props.collect,
    placement: props.placement,
    poster: props.poster,
    lang: props.lang,
    "bar-curve": props.barCurve === undefined ? undefined : String(props.barCurve),
    label: props.label,
    speeds: props.speeds?.join(" "),
    "preview-loop": props.previewLoop,
    "unmute-title": props.unmuteTitle,
    "unmute-text": props.unmuteText,
    "exit-poster": props.exitPoster,
    "smart-pause": props.smartPause ? "" : undefined,
    class: props.className,
  };
  return createElement("keep-watch", { ...attrs, style: props.style, suppressHydrationWarning: true });
}

/** Hidden until a player on the page unlocks its CTA (or fails to load). */
export function KeepwatchGate({ children, className }: { children: ReactNode; className?: string }) {
  return createElement("div", { "data-keepwatch-gate": "", className }, children);
}
