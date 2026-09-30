/**
 * The Keepwatch builder: a form made from FIELDS (src/config.ts), a live
 * <keep-watch> preview, and the embed code. The page carries the player's
 * own script (#kw-src), which is also what the "inline" embed copies, so the
 * built builder.html is one file that works offline.
 */
import {
  HOSTED_SCRIPT,
  FIELDS,
  GROUPS,
  configToAttributes,
  embedCode,
  validateConfig,
  type Field,
  type KeepwatchConfig,
} from "../src/config.ts";
import { parseSource } from "../src/sources.ts";

const STORE = "keepwatch-builder";
const DEFAULT_CONFIG: KeepwatchConfig = {
  src: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  video: "my-vsl",
  ctaAt: "0:15",
  ctaText: "Book your call",
  ctaHref: "#book",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const stage = $<HTMLDivElement>("stage");
const output = $<HTMLPreElement>("output");
const scriptMode = $<HTMLSelectElement>("script-mode");
const scriptUrl = $<HTMLInputElement>("script-url");
const log = $<HTMLDivElement>("log");

let config: KeepwatchConfig = load();
let tab: "embed" | "json" | "react" = "embed";

function load(): KeepwatchConfig {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return validateConfig(JSON.parse(raw)).config;
  } catch {
    // Blocked or corrupt storage: start from the example.
  }
  return { ...DEFAULT_CONFIG };
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(config));
  } catch {
    // Storage blocked: the settings hold for this visit.
  }
}

// ------------------------------------------------------------------ form

function control(field: Field): HTMLElement {
  const value = config[field.key];
  const def = "default" in field ? field.default : undefined;
  const set = (v: string | number | boolean | undefined) => {
    if (v === undefined || v === "" || v === def) delete config[field.key];
    else config[field.key] = v;
    changed();
  };

  if (field.type === "boolean") {
    const input = Object.assign(document.createElement("input"), { type: "checkbox", checked: (value ?? def ?? false) === true });
    input.addEventListener("change", () => set(input.checked));
    const wrap = document.createElement("label");
    wrap.className = "check";
    const text = document.createElement("span");
    text.innerHTML = `<span class="name"></span><br><span class="help"></span>`;
    text.querySelector(".name")!.textContent = field.label;
    text.querySelector(".help")!.textContent = field.help;
    wrap.append(input, text);
    return wrap;
  }

  const wrap = document.createElement("label");
  wrap.className = "field";
  const name = Object.assign(document.createElement("span"), { className: "name", textContent: field.label });
  wrap.append(name);

  if (field.type === "select" && "options" in field) {
    const select = document.createElement("select");
    for (const o of field.options) select.append(new Option(o.label, o.value));
    select.value = String(value ?? def ?? "");
    select.addEventListener("change", () => set(select.value));
    wrap.append(select);
  } else if (field.type === "list" && "options" in field) {
    const chosen = new Set(String(value ?? def ?? "").split(/\s+/).filter(Boolean));
    const chips = Object.assign(document.createElement("div"), { className: "chips" });
    for (const o of field.options) {
      const chip = document.createElement("label");
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: chosen.has(o.value) });
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(o.value);
        else chosen.delete(o.value);
        // Keep the documented order, whatever order they were ticked in.
        set(field.options.map((x) => x.value).filter((v) => chosen.has(v)).join(" "));
      });
      chip.append(box, o.label);
      chips.append(chip);
    }
    wrap.append(chips);
  } else if (field.type === "color") {
    const row = Object.assign(document.createElement("div"), { className: "color" });
    const picker = Object.assign(document.createElement("input"), { type: "color", value: String(value ?? def ?? "#000000") });
    const text = Object.assign(document.createElement("input"), { type: "text", value: String(value ?? "") , placeholder: String(def ?? "") });
    picker.addEventListener("input", () => {
      text.value = picker.value;
      set(picker.value);
    });
    text.addEventListener("change", () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
      set(text.value.trim());
    });
    row.append(picker, text);
    wrap.append(row);
  } else {
    const input = document.createElement("input");
    input.type = field.type === "number" ? "number" : field.type === "url" ? "url" : field.type === "datetime" ? "datetime-local" : "text";
    if (field.type === "number") input.step = "any";
    input.value = value === undefined ? "" : field.type === "datetime" ? String(value).slice(0, 16) : String(value);
    input.placeholder = "placeholder" in field ? field.placeholder : def !== undefined ? String(def) : "";
    input.addEventListener("change", () => {
      const raw = input.value.trim();
      if (field.type === "number") set(raw === "" ? undefined : Number(raw));
      else if (field.type === "datetime") set(raw ? new Date(raw).toISOString() : undefined);
      else set(raw);
    });
    wrap.append(input);
  }
  if (field.help) wrap.append(Object.assign(document.createElement("span"), { className: "help", textContent: field.help }));
  wrap.append(Object.assign(document.createElement("span"), { className: "issue", hidden: true, id: `issue-${field.key}` }));
  return wrap;
}

function renderForm() {
  form.replaceChildren();
  for (const group of GROUPS) {
    const details = document.createElement("details");
    details.open = group === "Video" || group === "Autoplay" || group === "Call to action";
    const summary = Object.assign(document.createElement("summary"), { textContent: group });
    const fields = Object.assign(document.createElement("div"), { className: "fields" });
    for (const field of FIELDS.filter((x) => x.group === group)) fields.append(control(field));
    details.append(summary, fields);
    form.append(details);
  }
}

// ------------------------------------------------------------------ preview

let previewTimer = 0;

function renderPreview() {
  const { attrs, style } = configToAttributes(config);
  const player = document.createElement("keep-watch");
  for (const [name, value] of attrs) {
    // The preview never reports watch data: it is the builder's own viewing.
    if (name !== "collect") player.setAttribute(name, value);
  }
  if (style) player.setAttribute("style", style);
  stage.classList.toggle("vertical", String(config.aspect ?? "").startsWith("9 /"));
  stage.replaceChildren(player);

  const note = $<HTMLParagraphElement>("stage-note");
  const source = typeof config.src === "string" ? parseSource(config.src) : null;
  note.className = "note";
  if (!source) note.textContent = "Paste a video link to see the player.";
  else if (location.protocol === "file:" && source.provider === "youtube") {
    note.className = "note warn";
    note.textContent = "YouTube refuses to play from a file:// page. Run `bun run builder` and open the localhost link.";
  } else note.textContent = `${source.provider} · previews do not send analytics.`;
}

function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(renderPreview, 350);
}

for (const name of ["play", "unmute", "pause", "progress", "cta-shown", "cta-click", "ended", "error"]) {
  document.addEventListener(`keepwatch:${name}`, (e) => {
    const d = (e as CustomEvent<{ time: number; percent?: number }>).detail;
    const line = `${new Date().toLocaleTimeString()}  ${name}${d.percent ? ` ${d.percent}%` : ""}  @${d.time.toFixed(1)}s`;
    log.textContent = `${line}\n${log.textContent ?? ""}`.split("\n").slice(0, 12).join("\n");
  });
}

// ------------------------------------------------------------------ output

function script(): { src: string } | { inline: string } {
  if (scriptMode.value === "inline") return { inline: $("kw-src").textContent ?? "" };
  if (scriptMode.value === "url" && scriptUrl.value.trim()) return { src: scriptUrl.value.trim() };
  return { src: HOSTED_SCRIPT };
}

/** React props are the config keys themselves (see src/react.tsx), typed as in the config. */
function reactCode(): string {
  const props: string[] = [];
  for (const field of FIELDS) {
    const value = config[field.key];
    if (value === undefined || value === "" || ("default" in field && field.default === value)) continue;
    if (value === true) props.push(field.key);
    else if (typeof value === "string") props.push(`${field.key}=${JSON.stringify(value)}`);
    else props.push(`${field.key}={${String(value)}}`);
  }
  if (config.variants?.length) props.unshift(`variants={${JSON.stringify(config.variants)}}`);
  return `import { Keepwatch } from "keepwatch/react";\n\n<Keepwatch\n  ${props.join("\n  ")}\n/>`;
}

function renderOutput() {
  if (tab === "json") output.textContent = JSON.stringify(config, null, 2);
  else if (tab === "react") output.textContent = reactCode();
  else {
    const code = embedCode(config, script());
    // An inline script is 70 KB of noise on screen: show where it goes, copy the real thing.
    output.textContent = scriptMode.value === "inline" ? code.replace(/<script>[\s\S]*?<\/script>/, "<script>/* Keepwatch player, inlined on copy */</script>") : code;
  }
  $("script-row").hidden = tab !== "embed";
  $("script-url-wrap").hidden = scriptMode.value !== "url";
}

function currentText(): string {
  if (tab === "embed") return embedCode(config, script());
  return output.textContent ?? "";
}

function showIssues() {
  document.querySelectorAll<HTMLElement>(".issue[id^='issue-']").forEach((n) => {
    n.hidden = true;
    n.textContent = "";
  });
  for (const issue of validateConfig(config).issues) {
    const node = document.getElementById(`issue-${issue.key}`);
    if (node) {
      node.hidden = false;
      node.textContent = issue.message;
    }
  }
}

function changed() {
  persist();
  showIssues();
  renderOutput();
  schedulePreview();
}

function download(name: string, text: string, type: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function testPage(): string {
  const title = String(config.label ?? config.video ?? "Keepwatch test");
  return `<!doctype html>
<html lang="${config.lang || "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, "&lt;")}</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 16px}#book{margin-top:32px;padding:24px;border-radius:16px;background:#eef3ff}</style>
</head>
<body>
${embedCode(config, script())}
</body>
</html>
`;
}

// ------------------------------------------------------------------ wiring

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab as typeof tab;
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderOutput();
  }),
);
scriptMode.addEventListener("change", renderOutput);
scriptUrl.addEventListener("input", renderOutput);

$("copy").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("copy");
  try {
    await navigator.clipboard.writeText(currentText());
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy blocked: select the text";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
});
$("download-json").addEventListener("click", () => download("keepwatch.config.json", `${JSON.stringify(config, null, 2)}\n`, "application/json"));
$("download-page").addEventListener("click", () => download(`${String(config.video || "keepwatch")}-test.html`, testPage(), "text/html"));

$("replay").addEventListener("click", () => {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("keepwatch:")) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was remembered anyway.
  }
  document.documentElement.removeAttribute("data-keepwatch-unlocked");
  renderPreview();
});

$("reset").addEventListener("click", () => {
  config = { ...DEFAULT_CONFIG };
  renderForm();
  changed();
});

const dialog = $<HTMLDialogElement>("import-dialog");
$("import").addEventListener("click", () => {
  $<HTMLTextAreaElement>("import-text").value = JSON.stringify(config, null, 2);
  $("import-issues").textContent = "";
  dialog.showModal();
});
$("import-apply").addEventListener("click", (e) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse($<HTMLTextAreaElement>("import-text").value);
  } catch {
    e.preventDefault();
    $("import-issues").textContent = "That is not valid JSON.";
    return;
  }
  const result = validateConfig(parsed);
  if (result.issues.length) {
    e.preventDefault();
    $("import-issues").textContent = result.issues.map((i) => `${i.key || "config"}: ${i.message}`).join("\n");
    // Apply what is valid, keep the dialog open to show what is not.
  }
  config = result.config;
  renderForm();
  changed();
});

renderForm();
changed();
renderPreview();
