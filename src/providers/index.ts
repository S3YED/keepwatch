import { parseSource, type Source } from "../sources.ts";
import { file } from "./file.ts";
import { loom } from "./loom.ts";
import type { Provider } from "./types.ts";
import { vimeo } from "./vimeo.ts";
import { youtube } from "./youtube.ts";

export type { MediaEvents, MediaHandle, MountOptions, Provider, ProviderMeta } from "./types.ts";

const registry = new Map<string, Provider>([vimeo, youtube, loom, file].map((p) => [p.id, p]));

/**
 * Add a provider (Wistia, Bunny's player, an in-house host), or replace a
 * built-in one. A custom provider's `parse` is tried before the built-in
 * parsers, so it can also claim links a built-in would take.
 */
export function registerProvider(provider: Provider): void {
  registry.set(provider.id, provider);
}

export function providerFor(source: Source): Provider | null {
  return registry.get(source.provider) ?? null;
}

/** Custom providers first, then the built-ins. */
export function resolveSource(input: string): Source | null {
  for (const p of registry.values()) {
    const source = p.parse?.(input);
    if (source) return source;
  }
  return parseSource(input);
}
