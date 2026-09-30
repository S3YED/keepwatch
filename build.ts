/**
 * Outputs:
 * - dist/builder.html: the settings builder, one self-contained file (the
 *   player script is inside it). SETTINGS.md is regenerated from src/config.ts.
 * - dist/keepwatch.js: one minified file for <script> tags (CDN). Registers <keep-watch>.
 * - dist/index.js, dist/server.js, dist/react.js: ESM for bundlers. @vimeo/player and
 *   react stay external there, so an app bundles them once.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { scriptSafe, settingsMarkdown } from "./src/config.ts";

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
const builderApp = await Bun.build({ entrypoints: ["builder/app.ts"], format: "iife", minify: true, target: "browser" });
for (const r of [script, esm, server, react, builderApp]) {
  if (!r.success) {
    for (const log of r.logs) console.error(log);
    process.exit(1);
  }
}
for (const o of [...script.outputs, ...esm.outputs, ...server.outputs, ...react.outputs]) console.log(o.path.replace(process.cwd() + "/", ""), `${(o.size / 1024).toFixed(1)} KB`);

const inline = scriptSafe;
const player = readFileSync("dist/keepwatch.js", "utf8");
const app = await builderApp.outputs[0].text();
const page = readFileSync("builder/index.html", "utf8")
  .replace("<!--KEEPWATCH-->", () => `<script id="kw-src">${inline(player)}</script>`)
  .replace("<!--APP-->", () => `<script>${inline(app)}</script>`);
writeFileSync("dist/builder.html", page);
console.log("dist/builder.html", `${(page.length / 1024).toFixed(1)} KB`);
writeFileSync("SETTINGS.md", settingsMarkdown());
