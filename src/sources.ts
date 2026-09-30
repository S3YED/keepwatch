/**
 * Video sources: which provider a link belongs to, and the id that provider
 * plays. Pure and DOM-free, so a server can render fallback links and a
 * collector can label rows with the same rules the player uses.
 *
 * Built in: Vimeo, YouTube, Loom, and plain files (MP4, WebM, MOV, HLS).
 * The browser side can add more with `registerProvider` (providers/index.ts).
 */

export type Source = {
  /** "vimeo" | "youtube" | "loom" | "file", or a registered custom provider. */
  provider: string;
  /** What the provider plays: a video id, or the absolute URL for "file". */
  id: string;
  /** Vimeo's access hash for unlisted videos (`vimeo.com/123/abc` or `?h=abc`). */
  hash?: string;
};

const FILE_EXT = /\.(mp4|m4v|webm|mov|ogv|m3u8)$/i;

function toUrl(input: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
}

const host = (url: URL, domain: string) => url.hostname === domain || url.hostname.endsWith(`.${domain}`);

export function parseVimeo(input: string): Source | null {
  const s = input.trim();
  if (/^\d{3,12}$/.test(s)) return { provider: "vimeo", id: s };
  const url = toUrl(s);
  if (!url || !host(url, "vimeo.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.findIndex((p) => /^\d{3,12}$/.test(p));
  if (at < 0) return null;
  const next = parts[at + 1];
  const hash = url.searchParams.get("h") ?? (next && /^[0-9a-f]{6,20}$/i.test(next) ? next : undefined);
  return hash ? { provider: "vimeo", id: parts[at], hash } : { provider: "vimeo", id: parts[at] };
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTube(input: string): Source | null {
  const url = toUrl(input.trim());
  if (!url) return null;
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host(url, "youtube.com") || host(url, "youtube-nocookie.com")) {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") id = url.searchParams.get("v");
    else if (first && ["embed", "shorts", "live", "v"].includes(first)) id = second ?? null;
  }
  return id && YT_ID.test(id) ? { provider: "youtube", id } : null;
}

export function parseLoom(input: string): Source | null {
  const url = toUrl(input.trim());
  if (!url || !host(url, "loom.com")) return null;
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if ((first === "share" || first === "embed") && second && /^[0-9a-f]{32}$/i.test(second)) {
    return { provider: "loom", id: second.toLowerCase() };
  }
  return null;
}

/** An absolute http(s) link to a video file or an HLS playlist. */
export function parseFile(input: string): Source | null {
  const s = input.trim();
  if (!/^https?:\/\//i.test(s) && !s.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(s, "https://relative.invalid");
  } catch {
    return null;
  }
  if (!FILE_EXT.test(url.pathname)) return null;
  // Keep a site-relative path relative: it resolves against the page that plays it.
  return { provider: "file", id: url.hostname === "relative.invalid" ? url.pathname + url.search : url.href };
}

/** The built-in parsers, in the order they are tried. */
export const BUILTIN_PARSERS: readonly ((input: string) => Source | null)[] = [parseVimeo, parseYouTube, parseLoom, parseFile];

export function parseSource(input: string): Source | null {
  for (const parse of BUILTIN_PARSERS) {
    const source = parse(input);
    if (source) return source;
  }
  return null;
}

/** The provider's own page for this video: the fallback link when our player cannot load. */
export function plainUrl(source: Source): string {
  switch (source.provider) {
    case "vimeo":
      return `https://player.vimeo.com/video/${source.id}?dnt=1${source.hash ? `&h=${source.hash}` : ""}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${source.id}`;
    case "loom":
      return `https://www.loom.com/share/${source.id}`;
    default:
      return source.id;
  }
}

/** A readable, stable default id for a source: "vimeo-1226915932", "youtube-dqw4w9wgxcq", "file-vsl-final". */
export function sourceKey(source: Source): string {
  if (source.provider === "file") {
    const name = source.id.split(/[?#]/)[0].split("/").pop() ?? "video";
    return `file-${name.replace(FILE_EXT, "")}`;
  }
  return `${source.provider}-${source.id}`;
}

/** The provider's display name, for "Watch it on …". */
export function providerName(provider: string): string {
  const known: Record<string, string> = { vimeo: "Vimeo", youtube: "YouTube", loom: "Loom" };
  return known[provider] ?? "";
}
