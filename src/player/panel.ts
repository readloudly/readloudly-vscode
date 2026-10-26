import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { inflateWasm } from './wasm.ts';

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
  | { type: 'word'; token: number; charIndex: number }
  | { type: 'error'; token: number; error: string }
  | { type: 'cmd'; cmd: 'toggle' | 'next' | 'previous' | 'stop' | 'faster' | 'slower' }
  | { type: 'voice'; name: string };

export function renderPlayer(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  storageUri: vscode.Uri
) {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  webview.options = { enableScripts: true, localResourceRoots: [mediaUri, storageUri] };
  const media = webview.asWebviewUri(mediaUri).toString();
  let wasm = '';
  try {
    const packed = vscode.Uri.joinPath(mediaUri, 'ort-wasm-simd-threaded.jsep.wasm.br').fsPath;
    wasm = webview.asWebviewUri(vscode.Uri.file(inflateWasm(packed, storageUri.fsPath))).toString();
  } catch (e) {
    console.error('ReadLoudly could not unpack the Kokoro engine; device voices still work', e);
  }
  webview.html = html(randomBytes(16).toString('base64'), media, wasm, webview.cspSource);
}

const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

function html(nonce: string, media: string, wasm: string, source: string): string {
  // Kokoro needs its bundle and WebAssembly from media/, and the model from Hugging Face on first use.
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${source} 'wasm-unsafe-eval'; connect-src ${source} https://huggingface.co https://*.hf.co; media-src blob:;`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${CSS}</style></head><body data-media="${media}" data-wasm="${wasm}">
<main>
  <div class="pill" role="toolbar" aria-label="ReadLoudly player">
    <button class="ib" id="previous" type="button" aria-label="Previous sentence" title="Previous sentence">${icon('<path d="m17 18-6-6 6-6"/><path d="M7 6v12"/>')}</button>
    <button class="play" id="toggle" type="button" aria-label="Play" data-paused><svg class="g-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1.2 1.2 0 0 0 1.8 1l10-6.4a1.2 1.2 0 0 0 0-2l-10-6.4A1.2 1.2 0 0 0 8 5.6z" fill="#fff"/></svg><svg class="g-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="#fff"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="#fff"/></svg></button>
    <button class="ib" id="next" type="button" aria-label="Next sentence" title="Next sentence">${icon('<path d="m7 18 6-6-6-6"/><path d="M17 6v12"/>')}</button>
    <button class="ib" id="stop" type="button" aria-label="Stop" title="Stop">${icon('<rect x="6" y="6" width="12" height="12" rx="2"/>')}</button>
    <span class="sep"></span>
    <button class="chip" id="speed" type="button" aria-label="Playback speed" title="Speed: click for faster, Shift+click for slower">${icon('<path d="M3.5 16.5a8.5 8.5 0 0 1 17 0"/><path id="needle" d="M12 16.5V10.8"/>')}<span id="speed-t">1×</span></button>
    <span class="time" id="time" title="Time left at this speed"></span>
    <button class="unlock" id="unlock" type="button" hidden>Turn on sound</button>
    <label class="sr" for="voice">Voice</label>
    <select id="voice" title="Voice"></select>
  </div>
  <div class="row"><p class="note" id="note" aria-live="polite"></p><p class="now" id="now" aria-live="polite"></p><span id="pos"></span><span id="file"></span></div>
  <div class="track" aria-hidden="true"><i id="track"></i></div>
</main>
<script nonce="${nonce}" src="${media}/player.js"></script>
</body></html>`;
}

const CSS = `
:root { --accent: #2d5cd2; --live: linear-gradient(135deg, #fb923c, #ff5a1f); --muted: var(--vscode-descriptionForeground); --line: var(--vscode-widget-border, rgba(128,128,128,.35)); --hover: var(--vscode-toolbar-hoverBackground); }
body.vscode-dark, body.vscode-high-contrast { --accent: #93c5fd; }
body { margin: 0; padding: 0; color: var(--vscode-foreground); font: 13px var(--vscode-font-family); }
main { position: relative; display: grid; gap: 4px; padding: 6px 12px 8px; }
button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: var(--vscode-foreground); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button:disabled { opacity: .4; cursor: default; }
svg { width: 18px; height: 18px; display: block; }
.pill { display: flex; align-items: center; gap: 2px; min-width: 0; }
.ib { flex: none; width: 28px; height: 28px; }
.ib:hover:not(:disabled) { background: var(--hover); }
.play { flex: none; position: relative; width: 32px; height: 32px; margin: 0 2px; background: var(--live); box-shadow: 0 6px 14px -6px rgba(255, 90, 31, .6); transition: transform .2s; }
.play svg { width: 16px; height: 16px; }
.play:hover:not(:disabled) { transform: scale(1.05); }
.play:active:not(:disabled) { transform: scale(.95); }
.play .g-play { translate: 1px 0; }
.play[data-paused] .g-pause, .play:not([data-paused]) .g-play { display: none; }
.play:not([data-paused])::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255, 90, 31, .6); animation: ripple 1.6s ease-out infinite; }
@keyframes ripple { from { transform: scale(1); opacity: .6; } to { transform: scale(1.55); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .play::after { animation: none !important; } .play { transition: none; } }
.chip { flex: none; height: 24px; padding: 0 8px 0 6px; gap: 4px; background: var(--hover); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.chip svg { width: 14px; height: 14px; }
#needle { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .3s; }
.sep { flex: none; width: 1px; height: 16px; background: var(--line); margin: 0 4px; }
.time { flex: none; color: var(--muted); padding: 0 6px; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.time:empty { display: none; }
.track { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--line); overflow: hidden; }
.track i { display: block; height: 100%; background: var(--accent); transform-origin: left; transform: scaleX(0); transition: transform .3s linear; }
.row { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.now, .note { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.now { color: var(--vscode-foreground); font-size: 13px; }
.note:empty, .note:not(:empty) + .now { display: none; }
#pos, #file { flex: none; white-space: nowrap; }
#file { max-width: 30%; overflow: hidden; text-overflow: ellipsis; }
#pos:empty, #file:empty { display: none; }
.unlock { flex: none; margin-left: auto; border-radius: 2px; padding: 3px 8px; font-size: 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.unlock:hover { background: var(--vscode-button-hoverBackground); }
.unlock[hidden] { display: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
select { flex: 0 1 150px; min-width: 64px; margin-left: auto; height: 24px; font: 12px var(--vscode-font-family); color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--line)); border-radius: 4px; padding: 0 4px; text-overflow: ellipsis; }
.unlock:not([hidden]) ~ select { margin-left: 4px; }
@media (max-width: 340px) { #file, .time { display: none; } }
@media (max-width: 260px) { .sep, #stop { display: none; } }
`;
