import assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface Api {
  highlighted(): vscode.Range[];
  status(): string;
  boots(): number;
  playerVisible(): boolean;
  clickLine(uri: vscode.Uri, line: number, selected?: boolean): void;
}

const run = (id: string) => vscode.commands.executeCommand(`readloudly.${id}`);
const plain = (title: string) =>
  title
    .replace(/\u200b/g, '')
    .trim()
    .replace(/\u2002/g, ' ');

suite('ReadLoudly free reader', () => {
  let api: Api;
  let doc: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let fetches = 0;
  const realFetch = globalThis.fetch;
  const lit = () => api.highlighted().map((r) => doc.getText(r));

  suiteSetup(async () => {
    // VS Code's own services share this fetch, so only calls made from the extension bundle count.
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      if (new Error().stack?.includes('/dist/extension.js')) fetches++;
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

  test('clicking a line shows play controls above it', async () => {
    await run('stop');
    api.clickLine(doc.uri, 8);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri
    );
    assert.deepEqual(
      lenses.map((l) => [l.range.start.line, l.command?.command]),
      [
        [8, 'readloudly.readFromLine'],
        [8, 'readloudly.cycleSpeed'],
        [8, 'readloudly.chooseVoice'],
      ]
    );
    await vscode.commands.executeCommand(
      lenses[0]!.command!.command,
      ...lenses[0]!.command!.arguments!
    );
    await run('togglePause');
    assert.deepEqual(lit(), ['See [the docs](https://example.com) for more.']);
    const playing = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri
    );
    assert.equal(plain(playing[0]!.command!.title), '$(readloudly-play) Resume');
  });

  test('reading chat or clipboard text leaves the clicked line without playback controls', async () => {
    await run('stop');
    api.clickLine(doc.uri, 8);
    await vscode.env.clipboard.writeText('Hi there. What do you need?');
    await run('readClipboard');
    assert.equal(api.status(), 'playing');
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri
    );
    assert.equal(lenses[0]!.command!.command, 'readloudly.readFromLine');
    await run('stop');
  });

  test('selecting text shows a Read selection button above it', async () => {
    await run('stop');
    const line = doc.lineAt(8).range;
    editor.selection = new vscode.Selection(line.start, line.end);
    api.clickLine(doc.uri, 8, true);
    const [first] = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri
    );
    assert.deepEqual(
      [plain(first!.command!.title), first!.command!.command],
      ['$(readloudly-play) Listen to selection', 'readloudly.readSelection']
    );
    await vscode.commands.executeCommand(first!.command!.command);
    assert.notEqual(api.status(), 'idle');
  });

  test('Read Focused reads the selection of whatever has focus and keeps the clipboard', async () => {
    await run('stop');
    await vscode.env.clipboard.writeText('kept');
    await vscode.window.showTextDocument(doc);
    const line = doc.lineAt(2).range;
    editor.selection = new vscode.Selection(line.start, line.end);
    await run('readFocused');
    assert.notEqual(api.status(), 'idle');
    assert.equal(await vscode.env.clipboard.readText(), 'kept');
  });

  test('Read Focused waits for a webview copy that lands after the command returns', async () => {
    await run('stop');
    await vscode.env.clipboard.writeText('kept');
    // VS Code copies from a webview by posting to its iframe, so the text arrives after executeCommand resolves.
    const slowCopy = vscode.commands.registerCommand('readloudlyTest.slowCopy', () =>
      setTimeout(() => void vscode.env.clipboard.writeText('Copied late from a webview.'), 150)
    );
    try {
      await vscode.commands.executeCommand('readloudly.readFocused', 'readloudlyTest.slowCopy');
      assert.notEqual(api.status(), 'idle');
      assert.equal(await vscode.env.clipboard.readText(), 'kept');
    } finally {
      slowCopy.dispose();
      await run('stop');
    }
  });

  test('Read Focused brings the hidden player back into view', async () => {
    await run('stop');
    await vscode.commands.executeCommand('workbench.view.search');
    await vscode.window.showTextDocument(doc);
    const line = doc.lineAt(2).range;
    editor.selection = new vscode.Selection(line.start, line.end);
    await run('readFocused');
    for (let i = 0; i < 30 && !api.playerVisible(); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(api.playerVisible(), 'the player stayed hidden');
  });

  test('Read File in a notebook reads the active Markdown cell', async () => {
    const folder = vscode.workspace.workspaceFolders![0]!.uri;
    const notebook = await vscode.workspace.openNotebookDocument(
      vscode.Uri.joinPath(folder, 'notes.ipynb')
    );
    const nbEditor = await vscode.window.showNotebookDocument(notebook);
    nbEditor.selections = [new vscode.NotebookRange(0, 1)];
    await vscode.commands.executeCommand('notebook.cell.edit');
    const cell = notebook.cellAt(0).document;
    for (let i = 0; i < 30 && vscode.window.activeTextEditor?.document !== cell; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      vscode.window.activeTextEditor?.document,
      cell,
      'the Markdown cell never took focus'
    );
    await run('readFile');
    await run('togglePause');
    assert.deepEqual(
      api.highlighted().map((r) => cell.getText(r)),
      ['Notebook notes']
    );
    await run('stop');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('M1 makes no network call', () => {
    assert.equal(fetches, 0);
  });
});
