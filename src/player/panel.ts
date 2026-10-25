import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export const VIEW_TYPE = 'readloudly.player';

export interface Voice {
  name: string;
  lang: string;
  isDefault: boolean;
  label?: string;
}

export type FromWebview =
  | { type: 'boot' }
  | { type: 'voices'; voices: Voice[] }
  | { type: 'ended'; token: number }
  | { type: 'error'; token: number; error: string }
  | { type: 'cmd'; cmd: 'toggle' | 'next' | 'previous' | 'stop' | 'faster' | 'slower' }
  | { type: 'voice'; name: string };

export function renderPlayer(webview: vscode.Webview, extensionUri: vscode.Uri) {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
  };
  const media = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media')).toString();
  webview.html = html(randomBytes(16).toString('base64'), media, webview.cspSource);
}

const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

function html(nonce: string, media: string, source: string): string {
  // Kokoro needs its bundle and WebAssembly from media/, and the model from Hugging Face on first use.
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${source} 'wasm-unsafe-eval'; connect-src ${source} https://huggingface.co https://*.hf.co; media-src blob:;`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${CSS}</style></head><body data-media="${media}">
<main>
  <div class="pill" role="toolbar" aria-label="ReadLoudly player">
    <button class="ib" id="previous" type="button" aria-label="Previous sentence" title="Previous sentence">${icon('<path d="m17 18-6-6 6-6"/><path d="M7 6v12"/>')}</button>
    <button class="play" id="toggle" type="button" aria-label="Play" data-paused><svg class="g-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1.2 1.2 0 0 0 1.8 1l10-6.4a1.2 1.2 0 0 0 0-2l-10-6.4A1.2 1.2 0 0 0 8 5.6z" fill="#fff"/></svg><svg class="g-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="#fff"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="#fff"/></svg></button>
    <button class="ib" id="next" type="button" aria-label="Next sentence" title="Next sentence">${icon('<path d="m7 18 6-6-6-6"/><path d="M17 6v12"/>')}</button>
    <span class="sep"></span>
    <button class="chip" id="speed" type="button" aria-label="Playback speed" title="Speed: click for faster, Shift+click for slower">${icon('<path d="M3.5 16.5a8.5 8.5 0 0 1 17 0"/><path id="needle" d="M12 16.5V10.8"/>')}<span id="speed-t">1×</span></button>
    <span class="time" id="time" title="Time left at this speed"></span>
    <span class="grow"></span>
    <button class="ib" id="stop" type="button" aria-label="Stop" title="Stop">${icon('<rect x="6" y="6" width="12" height="12" rx="2"/>')}</button>
  </div>
  <div class="track" aria-hidden="true"><i id="track"></i></div>
  <div class="row"><span id="pos"></span><span id="file"></span></div>
  <p class="now" id="now" aria-live="polite"></p>
  <p class="note" id="note" aria-live="polite"></p>
  <label for="voice">Voice</label>
  <select id="voice"></select>
</main>
<script nonce="${nonce}" src="${media}/player.js"></script>
</body></html>`;
}

const CSS = `
:root { --accent: #2d5cd2; --live: linear-gradient(135deg, #fb923c, #ff5a1f); --muted: var(--vscode-descriptionForeground); --line: var(--vscode-widget-border, rgba(128,128,128,.35)); --hover: var(--vscode-toolbar-hoverBackground); }
body.vscode-dark, body.vscode-high-contrast { --accent: #93c5fd; }
body { margin: 0; padding: 0; color: var(--vscode-foreground); font: 13px var(--vscode-font-family); }
main { display: grid; gap: 10px; padding: 10px 16px 14px; }
button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: var(--vscode-foreground); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button:disabled { opacity: .4; cursor: default; }
svg { width: 20px; height: 20px; display: block; }
.pill { display: flex; align-items: center; gap: 2px; }
.ib { width: 32px; height: 32px; }
.ib:hover:not(:disabled) { background: var(--hover); }
.play { position: relative; width: 40px; height: 40px; margin: 0 2px; background: var(--live); box-shadow: 0 8px 18px -6px rgba(255, 90, 31, .6); transition: transform .2s; }
.play:hover:not(:disabled) { transform: scale(1.05); }
.play:active:not(:disabled) { transform: scale(.95); }
.play .g-play { translate: 1px 0; }
.play[data-paused] .g-pause, .play:not([data-paused]) .g-play { display: none; }
.play:not([data-paused])::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255, 90, 31, .6); animation: ripple 1.6s ease-out infinite; }
@keyframes ripple { from { transform: scale(1); opacity: .6; } to { transform: scale(1.55); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .play::after { animation: none !important; } .play { transition: none; } }
.chip { height: 30px; padding: 0 10px 0 8px; gap: 5px; background: var(--hover); font-weight: 600; font-variant-numeric: tabular-nums; }
.chip svg { width: 16px; height: 16px; }
#needle { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .3s; }
.sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.time { color: var(--muted); padding: 0 8px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.grow { flex: 1; }
.track { height: 4px; border-radius: 99px; background: var(--line); overflow: hidden; }
.track i { display: block; height: 100%; background: var(--accent); transform-origin: left; transform: scaleX(0); transition: transform .3s linear; }
.row { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-variant-numeric: tabular-nums; }
.row span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.now { margin: 0; min-height: 2.8em; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
label { color: var(--muted); margin-bottom: -6px; }
select { font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--line)); border-radius: 6px; padding: 6px 8px; }
`;
