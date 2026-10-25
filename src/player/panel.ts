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
  | { type: 'word'; token: number; charIndex: number }
  | { type: 'error'; token: number; error: string }
  | { type: 'cmd'; cmd: 'toggle' };

export function renderPlayer(webview: vscode.Webview, extensionUri: vscode.Uri) {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
  };
  const media = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media')).toString();
  webview.html = html(randomBytes(16).toString('base64'), media, webview.cspSource);
}

function html(nonce: string, media: string, source: string): string {
  // Kokoro needs its bundle and WebAssembly from media/, and the model from Hugging Face on first use.
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${source} 'wasm-unsafe-eval'; connect-src ${source} https://huggingface.co https://*.hf.co; media-src blob:;`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${CSS}</style></head><body data-media="${media}">
<main>
  <p>The voice engine runs here. Reading controls are in the editor: select text and open the lightbulb, or click a line.</p>
  <p class="note" id="note" aria-live="polite"></p>
  <button id="unlock" type="button" hidden>Turn on sound</button>
</main>
<script nonce="${nonce}" src="${media}/player.js"></script>
</body></html>`;
}

const CSS = `
body { margin: 0; color: var(--vscode-descriptionForeground); font: 12px var(--vscode-font-family); }
main { display: grid; gap: 8px; padding: 4px 20px 10px; }
p { margin: 0; line-height: 1.4; }
.note:empty { display: none; }
.note { color: var(--vscode-foreground); }
button { justify-self: start; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; padding: 4px 12px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
`;
