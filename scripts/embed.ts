/**
 * `bun run embed <config.json> [--script <url> | --inline] [--page <out.html>]`
 *
 * Turn a keepwatch.config.json into the embed code, for agents and scripts.
 * Every problem in the config is printed and the exit code is 1, so a bad
 * config never becomes a broken embed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CDN_SCRIPT, embedCode, validateConfig } from "../src/config.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !["--script", "--page"].includes(args[args.indexOf(a) - 1] ?? ""));
if (!file) {
  console.error("usage: bun run embed <config.json> [--script <url> | --inline] [--page <out.html>]");
  process.exit(2);
}
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`[keepwatch] cannot read ${file}:`, err instanceof Error ? err.message : err);
  process.exit(1);
}
const { config, issues } = validateConfig(raw);
if (issues.length) {
  for (const i of issues) console.error(`[keepwatch] ${i.key || "config"}: ${i.message}`);
  process.exit(1);
}

const script = args.includes("--inline")
  ? { inline: readFileSync(new URL("../dist/keepwatch.js", import.meta.url), "utf8") }
  : { src: flag("--script") ?? CDN_SCRIPT };
const code = embedCode(config, script);
const out = flag("--page");
if (out) {
  writeFileSync(out, `<!doctype html>\n<html lang="${config.lang || "en"}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${String(config.video ?? "Keepwatch")}</title>\n</head>\n<body>\n${code}\n</body>\n</html>\n`);
  console.error(`[keepwatch] wrote ${out}`);
} else console.log(code);
