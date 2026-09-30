/**
 * `bun run builder`: serve the built builder on localhost. YouTube will not
 * play inside a file:// page, so the builder wants an http origin.
 */
const port = Number(process.env.PORT ?? 4720);
const path = new URL("../dist/builder.html", import.meta.url);
if (!(await Bun.file(path).exists())) {
  console.error("[keepwatch] dist/builder.html is missing: run `bun run build` first.");
  process.exit(1);
}
// Read per request, uncached, so a rebuild shows on reload.
Bun.serve({
  port,
  fetch: () => new Response(Bun.file(path), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }),
});
console.log(`Keepwatch builder: http://localhost:${port}`);
