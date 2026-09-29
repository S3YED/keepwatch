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
const esm = await Bun.build({
  entrypoints: ["src/index.ts", "src/server.ts", "src/react.tsx"],
  outdir: "dist",
  format: "esm",
  target: "browser",
  splitting: true,
  external: ["@vimeo/player", "react"],
});
for (const r of [script, esm]) {
  if (!r.success) {
    for (const log of r.logs) console.error(log);
    process.exit(1);
  }
}
for (const o of [...script.outputs, ...esm.outputs]) console.log(o.path.replace(process.cwd() + "/", ""), `${(o.size / 1024).toFixed(1)} KB`);
