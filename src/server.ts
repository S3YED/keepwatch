/**
 * Keepwatch without a DOM: the beat contract for collectors and dashboards,
 * and the config tools (validateConfig, embedCode) for builders and agents.
 * Validate with `parseBeat`, store with `mergeBeat`, chart with `summarise`.
 * Sales: `parseConversion`, stored once per `conversionKey`, marked as
 * browser-reported (unverified), at most MAX_CONVERSIONS_PER_VIEWER_PER_DAY per viewer.
 * `parseSource` and `plainUrl` are here too, for server-rendered fallback embeds.
 */
export {
  BEAT_MAX_BYTES,
  CONVERSION_MAX_BYTES,
  MAX_CONVERSIONS_PER_VIEWER_PER_DAY,
  MAX_VALUE,
  RANDOM_ID,
  conversionKey,
  mergeBeat,
  mmss,
  parseBeat,
  parseConversion,
  summarise,
  type Beat,
  type Conversion,
  type Stats,
  type ViewMeasures,
} from "./core.ts";
export { parseSource, plainUrl, providerName, type Source } from "./sources.ts";
export { FIELDS, configToAttributes, elementHtml, embedCode, validateConfig, type KeepwatchConfig } from "./config.ts";

/**
 * Is this Origin allowed to report? `allowed` holds hostnames; a leading
 * "*." allows subdomains ("*.weblyfe.nl" matches "learn.weblyfe.nl").
 * Origin is a browser header, so this keeps honest pages out of the wrong
 * dashboard; it is not authentication.
 */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((a) => {
    const rule = a.toLowerCase();
    if (rule.startsWith("*.")) return host === rule.slice(2) || host.endsWith(rule.slice(1));
    return host === rule;
  });
}
