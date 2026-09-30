"use client";

import { createElement, useEffect, type CSSProperties, type ReactNode } from "react";
import { configToAttributes, type KeepwatchConfig } from "./config.ts";

/**
 * React wrapper for <keep-watch>. Safe in server components' trees (Next.js):
 * the element registers in the browser only, on first mount. Props are the
 * config keys (SETTINGS.md), the same as keepwatch.config.json and the builder.
 *
 *   <Keepwatch src="https://vimeo.com/1226915932" ctaAt="6:11" ctaHref="#book"
 *              collect="https://getclark.app/api/vsl" />
 *   <KeepwatchGate>…booking section…</KeepwatchGate>
 */

export type KeepwatchProps = KeepwatchConfig & { className?: string; style?: CSSProperties };

let registering: Promise<unknown> | null = null;

export function Keepwatch({ className, style, ...config }: KeepwatchProps) {
  useEffect(() => {
    // Through the package name, not "./element.ts": the built react.js must
    // not carry the element, which extends HTMLElement and cannot load on a server.
    registering ??= import("keepwatch").then((m) => m.define());
  }, []);
  const { attrs, style: look } = configToAttributes(config);
  const props: Record<string, unknown> = Object.fromEntries(attrs);
  props.class = className;
  // Look settings are CSS custom properties; a page's own `style` wins over them.
  const custom = Object.fromEntries(look ? look.split("; ").map((d) => d.split(": ")) : []);
  props.style = { ...custom, ...style };
  props.suppressHydrationWarning = true;
  return createElement("keep-watch", props);
}

/** Hidden until a player on the page unlocks its CTA (or fails to load). */
export function KeepwatchGate({ children, className }: { children: ReactNode; className?: string }) {
  return createElement("div", { "data-keepwatch-gate": "", className }, children);
}
