/**
 * Keepwatch for collectors and dashboards: the beat contract with no DOM.
 * Validate with `parseBeat`, store with `mergeBeat`, chart with `summarise`.
 * `parseSource` and `plainUrl` are here too, for server-rendered fallback embeds.
 */
export {
  BEAT_MAX_BYTES,
  mergeBeat,
  mmss,
  parseBeat,
  summarise,
  type Beat,
  type Stats,
  type ViewMeasures,
} from "./core.ts";
export { parseSource, plainUrl, providerName, type Source } from "./sources.ts";

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
