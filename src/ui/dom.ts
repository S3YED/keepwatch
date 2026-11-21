/** Small DOM helpers shared by the player shell and its parts. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** Larger than any captions file; a wrong link to a video must not be read into memory as text. */
const TEXT_MAX_BYTES = 2_000_000;

/**
 * Fetch a small text file (WebVTT). Resolves "" on any failure, and says why
 * on the console: captions and chapters are extras, the video plays without them.
 */
export async function fetchText(url: string, what: string): Promise<string> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > TEXT_MAX_BYTES) throw new Error("file too large");
    const text = await res.text();
    return text.length > TEXT_MAX_BYTES ? "" : text;
  } catch (err) {
    console.error(`[keepwatch] ${what} could not load from ${url}:`, err instanceof Error ? err.message : err);
    return "";
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
