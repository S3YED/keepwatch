/**
 * Shadow DOM styles. Everything a site may want to change is a custom
 * property on the element:
 *   --kw-accent       play button, unmute card, pills  (default #2f6bff)
 *   --kw-on-accent    text and icons on the accent     (default #fff)
 *   --kw-chrome       control pill background          (default: the accent, 78%)
 *   --kw-bar          progress fill                    (default #fff)
 *   --kw-radius       frame corners                    (default 16px)
 *   --kw-font         font family                      (default inherit)
 *   --kw-aspect       aspect ratio                     (default 16 / 9)
 */
export const CSS = /* css */ `
:host {
  --_accent: var(--kw-accent, #2f6bff);
  --_on: var(--kw-on-accent, #fff);
  --_chrome: var(--kw-chrome, color-mix(in srgb, var(--_accent) 78%, transparent));
  display: block;
  position: relative;
  container-type: inline-size;
  aspect-ratio: var(--kw-aspect, 16 / 9);
  border-radius: var(--kw-radius, 16px);
  overflow: hidden;
  background: #000;
  color: var(--_on);
  font-family: var(--kw-font, inherit);
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}
:host(:fullscreen) { border-radius: 0; }
:host([data-phase="playing"]:not([data-active])) { cursor: none; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
button:focus-visible, a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.icon { width: 1em; height: 1em; display: block; }

.stage, .media, .poster, .surface, .facade, .unmute, .panel { position: absolute; inset: 0; width: 100%; height: 100%; }
.stage { z-index: 0; }
.media { border: 0; display: block; background: #000; object-fit: contain; }
.poster { z-index: 1; object-fit: cover; filter: brightness(.82); transition: filter .2s, transform .35s ease; }
.poster[hidden] { display: none; }
.surface { z-index: 2; border: 0; padding: 0; background: none; cursor: pointer; }

/* Poster with a play button: before autoplay, and when the browser refused it. */
.facade { z-index: 3; display: grid; place-items: center; border: 0; padding: 0; background: none; cursor: pointer; }
.play {
  display: grid; place-items: center;
  width: clamp(64px, 11cqi, 96px); height: clamp(64px, 11cqi, 96px); border-radius: 999px;
  background: var(--_accent); color: var(--_on); font-size: clamp(24px, 4cqi, 36px); padding-left: .12em;
  box-shadow: 0 24px 60px -12px rgba(0,0,0,.55); transition: transform .2s ease;
}
.facade:hover .play { transform: scale(1.06); }

/* The muted preview: one big card, no controls, no progress bar. */
.unmute { z-index: 3; display: grid; place-items: center; border: 0; padding: 4%; background: rgba(0,0,0,.12); cursor: pointer; }
.card {
  display: grid; justify-items: center; gap: clamp(4px, 1.2cqi, 14px);
  width: min(62%, 620px); padding: clamp(14px, 4cqi, 48px) clamp(16px, 4cqi, 48px);
  border-radius: clamp(14px, 3cqi, 32px); border: 1px solid rgba(255,255,255,.18);
  background: color-mix(in srgb, var(--_accent) 58%, transparent);
  -webkit-backdrop-filter: blur(6px) saturate(1.2); backdrop-filter: blur(6px) saturate(1.2);
  box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); text-align: center; line-height: 1.15;
  transition: transform .2s ease;
}
.unmute:hover .card { transform: scale(1.02); }
.card .icon { font-size: clamp(34px, 9cqi, 96px); }
.card .title { font-size: clamp(15px, 4.2cqi, 44px); font-weight: 800; }
.card .sub { font-size: clamp(14px, 3.8cqi, 40px); font-weight: 800; }
.wave1, .wave2 { animation: wave 1.5s ease-in-out infinite; }
.wave2 { animation-delay: .2s; }
@keyframes wave { 0%, 100% { opacity: .2; } 45% { opacity: 1; } }

.panel {
  z-index: 3; display: grid; place-content: center; justify-items: center; gap: 14px; padding: 16px;
  text-align: center; color: #fff; background: rgba(0,0,0,.62);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
.panel p { margin: 0; font-size: clamp(16px, 3cqi, 26px); font-weight: 700; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 20px;
  border-radius: 999px; border: 1px solid transparent; font-weight: 650; font-size: 15px;
  text-decoration: none; cursor: pointer; background: var(--_accent); color: var(--_on);
}
.btn.ghost { background: rgba(255,255,255,.08); color: #fff; border-color: rgba(255,255,255,.5); }

/* Controls: three pill groups over a thin rail, like Vidalytics. */
.chrome {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;
  padding: 28px clamp(8px, 2cqi, 20px) clamp(20px, 3.4cqi, 34px);
  background: linear-gradient(to top, rgba(0,0,0,.45), transparent);
  opacity: 0; transition: opacity .25s; pointer-events: none;
}
:host([data-active]) .chrome, :host(:focus-within) .chrome, :host([data-phase="paused"]) .chrome, .chrome.open { opacity: 1; pointer-events: auto; }
@media (hover: none) { .chrome { opacity: 1; pointer-events: auto; } }
.chrome[hidden] { display: none; }
.controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.group {
  position: relative; display: flex; align-items: center; gap: 2px;
  height: clamp(40px, 6.4cqi, 58px); padding: 0 clamp(6px, 1.4cqi, 14px); border-radius: 999px;
  background: var(--_chrome); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.group.wide { padding: 0 clamp(14px, 3.6cqi, 40px); }
.ctl {
  display: grid; place-items: center; width: clamp(34px, 5.4cqi, 48px); height: clamp(34px, 5.4cqi, 48px);
  border: 0; border-radius: 999px; background: none; font-size: clamp(18px, 3cqi, 28px); cursor: pointer;
}
.ctl:hover { background: rgba(255,255,255,.14); }
.time { padding: 0 clamp(4px, 1cqi, 10px); font-size: clamp(13px, 2.2cqi, 22px); font-variant-numeric: tabular-nums; letter-spacing: .02em; white-space: nowrap; }

.menu {
  position: absolute; right: 0; bottom: calc(100% + 8px); min-width: 170px; padding: 6px;
  border-radius: 14px; background: rgb(12,14,22); box-shadow: 0 20px 50px -12px rgba(0,0,0,.6);
  display: grid; gap: 2px; color: #fff;
}
.menu[hidden] { display: none; }
.menu h3 { margin: 4px 10px 6px; font-size: 12px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
.menu button {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  min-height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: none; font-size: 14px; cursor: pointer; text-align: left;
}
.menu button:hover { background: rgba(255,255,255,.1); }
.menu button .icon { font-size: 16px; visibility: hidden; }
.menu button[aria-pressed="true"] .icon { visibility: visible; }

.rail {
  position: absolute; z-index: 5; left: clamp(8px, 2cqi, 20px); right: clamp(8px, 2cqi, 20px); bottom: clamp(8px, 1.6cqi, 16px);
  height: clamp(4px, .7cqi, 7px); border-radius: 999px; background: rgba(255,255,255,.3); overflow: hidden; pointer-events: none;
}
.rail[hidden] { display: none; }
.fill { height: 100%; width: calc(var(--kw-p, 0) * 100%); border-radius: inherit; background: var(--kw-bar, #fff); transition: width .25s linear; }

.cta { position: absolute; right: clamp(10px, 2cqi, 20px); bottom: clamp(76px, 12cqi, 110px); z-index: 4; animation: rise .4s ease both; }
.cta.bare { bottom: clamp(52px, 8cqi, 72px); }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }

@container (max-width: 440px) {
  .time { display: none; }
  .card { width: 78%; }
}

@media (prefers-reduced-motion: reduce) {
  .wave1, .wave2, .cta { animation: none; }
  .wave1, .wave2 { opacity: 1; }
  .fill, .card, .play, .poster { transition: none; }
}
`;

/**
 * Injected once into the page (not the shadow root): hides every
 * `[data-keepwatch-gate]` until a player unlocks its CTA. Fail-open by
 * design: if the script never loads, the gates are visible.
 */
export const GATE_CSS = `html:not([data-keepwatch-unlocked]) [data-keepwatch-gate]{display:none!important}`;
