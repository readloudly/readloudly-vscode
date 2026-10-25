import assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface Api {
  status(): string;
}

const run = (id: string, ...args: unknown[]) =>
  vscode.commands.executeCommand(`readloudly.${id}`, ...args);

suite('ReadLoudly AI', () => {
  let api: Api;

  suiteSetup(async () => {
    api = (await vscode.extensions.getExtension('readloudly.readloudly-vscode')!.activate()) as Api;
    const folder = vscode.workspace.workspaceFolders![0]!.uri;
    await vscode.window.showTextDocument(vscode.Uri.joinPath(folder, 'sample.md'));
  });

  teardown(() => run('stop'));

  test('without a language model nothing is opened or read', async () => {
    assert.equal(
      (await vscode.lm.selectChatModels()).length,
      0,
      'this test needs a host without models'
    );
    await run('summarizeAndListen');
    assert.ok(!vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'readloudly-ai'));
    assert.equal(api.status(), 'idle');
  });

  test('the agent tool reads the text it is given', async () => {
    const result = await vscode.lm.invokeTool('readloudly_read_aloud', {
      input: { text: 'Agent mode can read this aloud.' },
      toolInvocationToken: undefined,
    });
    const part = result.content[0] as vscode.LanguageModelTextPart;
    assert.match(part.value, /reading the text aloud/);
    assert.notEqual(api.status(), 'idle');
  });

  test('Listen on a chat answer reads its Markdown as prose', async () => {
    await run('listenText', '**Short** answer. With `code`.');
    assert.notEqual(api.status(), 'idle');
  });
});
