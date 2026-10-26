import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const stub = `
const uri = (p) => ({ fsPath: p, toString: () => p });
export const Uri = { file: uri, joinPath: (b, ...s) => uri([b.fsPath, ...s].join('/')) };
`;

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'vscode'
      ? { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true }
      : next(specifier, context),
});

const { renderPlayer } = await import('./panel.ts');

const uri = (fsPath: string) => ({ fsPath, toString: () => fsPath });

test('player webview keeps its controls and CSP', () => {
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview:',
    asWebviewUri: (u: unknown) => u,
  };
  const storage = uri(mkdtempSync(join(tmpdir(), 'rl-panel-')));
  renderPlayer(
    webview as never,
    uri(resolve(import.meta.dirname, '../..')) as never,
    storage as never
  );
  const ids = [
    'previous',
    'toggle',
    'next',
    'speed',
    'stop',
    'track',
    'pos',
    'file',
    'now',
    'note',
    'unlock',
    'voice',
  ];
  for (const id of ids) assert.match(webview.html, new RegExp(`id="${id}"`), `missing #${id}`);
  assert.match(webview.html, /<label[^>]*for="voice"/);
  assert.match(webview.html, /<select[^>]*id="voice"/);
  assert.match(webview.html, /<meta http-equiv="Content-Security-Policy"/);
});
