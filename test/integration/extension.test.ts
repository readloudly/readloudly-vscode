import assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface Api {
  highlighted(): vscode.Range[];
  status(): string;
  boots(): number;
}

const run = (id: string) => vscode.commands.executeCommand(`readloudly.${id}`);

suite('ReadLoudly free reader', () => {
  let api: Api;
  let doc: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let fetches = 0;
  const realFetch = globalThis.fetch;
  const lit = () => api.highlighted().map((r) => doc.getText(r));

  suiteSetup(async () => {
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetches++;
      return realFetch(...args);
    }) as typeof fetch;
    api = (await vscode.extensions.getExtension('readloudly.readloudly-vscode')!.activate()) as Api;
    const folder = vscode.workspace.workspaceFolders![0]!.uri;
    doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'sample.md'));
    editor = await vscode.window.showTextDocument(doc);
  });

  suiteTeardown(async () => {
    await run('stop');
    globalThis.fetch = realFetch;
  });

  test('Read File highlights the heading, then Next moves to the next sentence', async () => {
    await run('readFile');
    await run('togglePause');
    assert.equal(api.status(), 'paused');
    assert.deepEqual(lit(), ['Getting started']);
    await run('next');
    assert.deepEqual(lit(), ['ReadLoudly reads this file aloud.']);
  });

  test('the player view loads its page', async () => {
    for (let i = 0; i < 50 && api.boots() === 0; i++) await new Promise((r) => setTimeout(r, 200));
    assert.ok(api.boots() > 0, 'the player webview never sent boot');
  });

  test('Read Selection reads link text and highlights the source range', async () => {
    const line = doc.lineAt(8).range;
    editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(line.start, line.end);
    await run('readSelection');
    await run('togglePause');
    assert.deepEqual(lit(), ['See [the docs](https://example.com) for more.']);
  });

  test('editing the document clears the stale highlight and pauses', async () => {
    await run('readFile');
    const at = new vscode.Position(0, 0);
    const insert = new vscode.WorkspaceEdit();
    insert.insert(doc.uri, at, ' ');
    await vscode.workspace.applyEdit(insert);
    assert.equal(api.status(), 'paused');
    assert.deepEqual(lit(), []);
    const revert = new vscode.WorkspaceEdit();
    revert.delete(doc.uri, new vscode.Range(at, at.translate(0, 1)));
    await vscode.workspace.applyEdit(revert);
  });

  test('M1 makes no network call', () => {
    assert.equal(fetches, 0);
  });
});
