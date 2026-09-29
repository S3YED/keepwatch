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
  /** Accessible name of the video. */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

let registering: Promise<unknown> | null = null;

export function Keepwatch(props: KeepwatchProps) {
  useEffect(() => {
    registering ??= import("./element.ts").then((m) => m.define());
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
    class: props.className,
  };
  return createElement("keep-watch", { ...attrs, style: props.style, suppressHydrationWarning: true });
}

/** Hidden until a player on the page unlocks its CTA (or fails to load). */
export function KeepwatchGate({ children, className }: { children: ReactNode; className?: string }) {
  return createElement("div", { "data-keepwatch-gate": "", className }, children);
}
