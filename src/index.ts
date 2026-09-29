/**
 * Keepwatch for bundlers: `import "keepwatch"` registers <keep-watch>.
 * Browser only. Server code imports "keepwatch/server".
 */
import { define } from "./element.ts";

define();

export { KeepWatchElement, define } from "./element.ts";
export { STRINGS, type Lang } from "./i18n.ts";
export * from "./core.ts";
