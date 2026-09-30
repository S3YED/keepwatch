/**
 * Player icons: Lucide (https://lucide.dev, ISC licence) paths, inlined so
 * the player has no icon dependency. `rewind10` adds the "10" to Lucide's
 * rotate-ccw; `speaker` is volume-2 with a filled body and waves the CSS
 * animates (.wave1, .wave2) for the unmute card.
 */
const SPEAKER_BODY =
  "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z";

const PATHS = {
  play: `<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" fill="currentColor"/>`,
  pause: `<rect x="14" y="3" width="5" height="18" rx="1" fill="currentColor"/><rect x="5" y="3" width="5" height="18" rx="1" fill="currentColor"/>`,
  rewind10: `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><text x="12.4" y="15.6" text-anchor="middle" font-size="8" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">10</text>`,
  volume: `<path d="${SPEAKER_BODY}"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`,
  muted: `<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>`,
  settings: `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>`,
  maximize: `<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`,
  minimize: `<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  speaker: `<path d="${SPEAKER_BODY}" fill="currentColor"/><path class="wave1" d="M16 9a5 5 0 0 1 0 6"/><path class="wave2" d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`,
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, cls = "icon"): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}
