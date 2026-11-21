/**
 * Keepwatch for bundlers: `import "keepwatch"` registers <keep-watch>.
 * Browser only. Server code imports "keepwatch/server".
 */
import { define } from "./element.ts";
import { convert } from "./viewer.ts";

define();

/* The <script> build has no exports: `keepwatch.convert()` is how a
   thank-you page reaches it. */
if (typeof window !== "undefined") {
  const w = window as unknown as { keepwatch?: Record<string, unknown> };
  w.keepwatch = { ...w.keepwatch, convert };
}

export { KeepWatchElement, define } from "./element.ts";
export { STRINGS, type Lang } from "./i18n.ts";
export { registerProvider, type MediaEvents, type MediaHandle, type MountOptions, type Provider, type ProviderMeta } from "./providers/index.ts";
export * from "./sources.ts";
export * from "./core.ts";
export { convert, defineConvert, viewer, type ConvertInput, type Viewer } from "./viewer.ts";
