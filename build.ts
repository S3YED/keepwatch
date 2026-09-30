/**
 * Three outputs:
 * - dist/keepwatch.js: one minified file for <script> tags (CDN). Registers <keep-watch>.
 * - dist/index.js, dist/server.js, dist/react.js: ESM for bundlers. @vimeo/player and
 *   react stay external there, so an app bundles them once.
 */
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const script = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  naming: "keepwatch.js",
  format: "iife",
  minify: true,
  target: "browser",
});
/* One self-contained file per entry, no code splitting: Bun's split
   output drops the "use client" directive and prepends a chunk preloader
   that touches `document` at import, which breaks server rendering in
   Next.js. The React entry loads the element through the package's own
   name ("keepwatch"), so it stays external here and browser-only there. */
const entry = (file: string, banner?: string) =>
  Bun.build({
    entrypoints: [file],
    outdir: "dist",
    format: "esm",
    target: "browser",
    external: ["@vimeo/player", "react", "keepwatch"],
    banner,
  });
const esm = await entry("src/index.ts");
const server = await entry("src/server.ts");
const react = await entry("src/react.tsx", '"use client";');
for (const r of [script, esm, server, react]) {
  if (!r.success) {
    for (const log of r.logs) console.error(log);
    process.exit(1);
  }
}
for (const o of [...script.outputs, ...esm.outputs, ...server.outputs, ...react.outputs]) console.log(o.path.replace(process.cwd() + "/", ""), `${(o.size / 1024).toFixed(1)} KB`);
