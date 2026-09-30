import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIELDS, configToAttributes, elementHtml, embedCode, settingsMarkdown, validateConfig } from "./config.ts";

test("defaults stay out of the embed; booleans switch the right way", () => {
  const { attrs, style } = configToAttributes({
    src: "https://youtu.be/dQw4w9WgXcQ",
    autoplay: "load",
    unmuteRestart: false,
    noPause: true,
    smartPause: false,
    bar: "rapid",
    accent: "#ff3366",
    aspect: "16 / 9",
  });
  expect(attrs).toEqual([
    ["src", "https://youtu.be/dQw4w9WgXcQ"],
    ["unmute-restart", "false"],
    ["no-pause", ""],
  ]);
  expect(style).toBe("--kw-accent: #ff3366");
});

test("variants replace src", () => {
  const { attrs } = configToAttributes({ src: "https://vimeo.com/1", variants: [{ id: "a", src: "https://vimeo.com/1" }] });
  expect(attrs[0][0]).toBe("variants");
  expect(attrs.some(([n]) => n === "src")).toBe(false);
});

test("the element and embed escape values and add a gate for #anchors", () => {
  const html = elementHtml({ src: "https://vimeo.com/1", ctaText: 'Book "now" <b>', ctaHref: "#book", ctaAt: "6:11" });
  expect(html).toContain('cta-text="Book &quot;now&quot; &lt;b>"');
  const embed = embedCode({ src: "https://vimeo.com/1", ctaHref: "#book", ctaAt: "6:11" }, { src: "https://cdn.example/kw.js" });
  expect(embed).toContain('<script src="https://cdn.example/kw.js" defer></script>');
  expect(embed).toContain('<section id="book" data-keepwatch-gate>');
  const inline = embedCode({ src: "https://vimeo.com/1" }, { inline: "var a='</script>', b='<!--', c=/<script>/" });
  expect(inline).toContain("var a='\\x3C/script>', b='\\x3C!--', c=/\\x3Cscript>/");
});

test("validation reports every problem and keeps the good settings", () => {
  const { config, issues } = validateConfig({
    src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    autoplay: "sometimes",
    ctaAt: "later",
    noPause: "yes",
    controls: "play laser",
    colour: "red",
    accent: "#000000",
  });
  expect(config).toEqual({ src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", controls: "play laser", accent: "#000000" });
  expect(issues.map((i) => i.key).sort()).toEqual(["autoplay", "colour", "controls", "ctaAt", "noPause"]);
  expect(validateConfig({}).issues[0].key).toBe("src");
  expect(validateConfig({ src: "https://example.com/page" }).issues[0].key).toBe("src");
});

test("every setting is documented and every attribute is read by the player", () => {
  const element = readFileSync(new URL("./element.ts", import.meta.url), "utf8");
  const docs = settingsMarkdown();
  for (const field of FIELDS) {
    expect(docs).toContain(`\`${field.key}\``);
    if ("attr" in field && field.attr) expect(element).toContain(`"${field.attr}"`);
  }
});

test("SETTINGS.md is regenerated from the settings list", () => {
  expect(readFileSync(new URL("../SETTINGS.md", import.meta.url), "utf8")).toBe(settingsMarkdown());
});
