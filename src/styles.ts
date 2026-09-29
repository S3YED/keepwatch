/**
 * Shadow DOM styles. Everything a site may want to change is a custom
 * property on the element:
 *   --kw-accent       buttons, bar, unmute card    (default #2f6bff)
 *   --kw-on-accent    text on the accent           (default #fff)
 *   --kw-radius       frame corners                (default 16px)
 *   --kw-font         font family                  (default inherit)
 *   --kw-aspect       aspect ratio                 (default 16 / 9)
 */
export const CSS = /* css */ `
:host {
  display: block;
  position: relative;
  aspect-ratio: var(--kw-aspect, 16 / 9);
  border-radius: var(--kw-radius, 16px);
  overflow: hidden;
  background: #000;
  font-family: var(--kw-font, inherit);
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}
:host(:fullscreen) { border-radius: 0; }
* { box-sizing: border-box; }
button { font: inherit; }

.iframe, .poster, .surface, .facade, .unmute, .panel { position: absolute; inset: 0; width: 100%; height: 100%; }
.iframe { border: 0; display: block; }
.poster { object-fit: cover; filter: brightness(0.82); transition: filter .2s, transform .35s ease; }
.surface { z-index: 1; border: 0; padding: 0; background: none; cursor: pointer; }

.facade { z-index: 2; display: grid; place-items: center; border: 0; padding: 0; background: none; cursor: pointer; }
.facade:hover .poster { filter: brightness(.92); transform: scale(1.015); }
.play {
  position: relative; z-index: 1; display: grid; place-items: center;
  width: clamp(64px, 8vw, 84px); height: clamp(64px, 8vw, 84px); border-radius: 999px;
  background: var(--kw-accent, #2f6bff); color: var(--kw-on-accent, #fff);
  font-size: clamp(20px, 2.6vw, 26px); padding-left: 5px;
  box-shadow: 0 24px 60px -12px rgba(0,0,0,.55); transition: transform .2s ease;
}
.facade:hover .play { transform: scale(1.06); }
.label { position: absolute; z-index: 1; bottom: clamp(14px, 2.4vw, 22px); color: #fff; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-shadow: 0 1px 12px rgba(0,0,0,.6); }

.unmute { z-index: 3; display: grid; place-items: center; border: 0; padding: 0; background: rgba(0,0,0,.18); cursor: pointer; }
.card {
  display: grid; justify-items: center; gap: 6px;
  padding: clamp(14px, 2.4vw, 22px) clamp(18px, 3.4vw, 32px); border-radius: 14px;
  background: var(--kw-accent, #2f6bff); color: var(--kw-on-accent, #fff);
  box-shadow: 0 24px 60px -12px rgba(0,0,0,.55); animation: breathe 2.4s ease infinite;
}
.card .icon { font-size: clamp(28px, 4vw, 40px); line-height: 1; }
.card .title { font-size: clamp(14px, 1.8vw, 18px); font-weight: 700; }
.card .sub { font-size: clamp(12px, 1.4vw, 14px); opacity: .9; }
@keyframes breathe { 50% { transform: scale(1.04); } }

.panel {
  z-index: 3; display: grid; place-content: center; justify-items: center; gap: 14px; padding: 16px;
  text-align: center; color: #fff; background: rgba(0,0,0,.62); backdrop-filter: blur(2px);
}
.panel p { margin: 0; font-size: clamp(16px, 2.2vw, 22px); font-weight: 700; }
.row { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 20px;
  border-radius: 999px; border: 1px solid transparent; font-weight: 600; font-size: 15px;
  text-decoration: none; cursor: pointer;
  background: var(--kw-accent, #2f6bff); color: var(--kw-on-accent, #fff);
}
.btn.ghost { background: rgba(255,255,255,.08); color: #fff; border-color: rgba(255,255,255,.5); }

.bar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; display: flex; align-items: center; gap: 6px;
  padding: 24px 10px 8px; background: linear-gradient(to top, rgba(0,0,0,.55), transparent);
  opacity: 0; transition: opacity .25s;
}
:host(:hover) .bar, :host(:focus-within) .bar, :host([data-phase="paused"]) .bar { opacity: 1; }
@media (hover: none) { .bar { opacity: 1; } }
.spacer { flex: 1; }
.ctl { display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 999px; background: none; color: #fff; font-size: 15px; cursor: pointer; }
.ctl:hover, .ctl:focus-visible { background: rgba(255,255,255,.16); }

.rail { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; height: 5px; background: rgba(255,255,255,.22); pointer-events: none; }
.fill { height: 100%; width: calc(var(--kw-p, 0) * 100%); background: var(--kw-accent, #2f6bff); transition: width .25s linear; }

.cta { position: absolute; right: clamp(10px, 2vw, 18px); bottom: clamp(52px, 7vw, 64px); z-index: 4; animation: rise .4s ease both; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }

@media (prefers-reduced-motion: reduce) { .card, .cta { animation: none; } .fill { transition: none; } }
`;

/**
 * Injected once into the page (not the shadow root): hides every
 * `[data-keepwatch-gate]` until a player unlocks its CTA. Fail-open by
 * design: if the script never loads, the gates are visible.
 */
export const GATE_CSS = `html:not([data-keepwatch-unlocked]) [data-keepwatch-gate]{display:none!important}`;
