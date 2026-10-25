import assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface Api {
  status(): string;
  sent(): { type: string; text?: string; voice?: string }[];
}
const lastSpeak = (api: Api) => api.sent().findLast((m) => m.type === 'speak');

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

  test('the agent tool reads its text with the device voice, even when a ReadLoudly voice is chosen', async () => {
    const voice = vscode.workspace.getConfiguration('readloudly');
    await voice.update('voice', 'rl:voice-1', vscode.ConfigurationTarget.Global);
    const result = await vscode.lm.invokeTool('readloudly_read_aloud', {
      input: { text: 'Agent mode can read this aloud.' },
      toolInvocationToken: undefined,
    });
    const part = result.content[0] as vscode.LanguageModelTextPart;
    assert.match(part.value, /reading the text aloud/);
    assert.equal(lastSpeak(api)?.text, 'Agent mode can read this aloud.');
    assert.equal(lastSpeak(api)?.voice, '');
    await voice.update('voice', undefined, vscode.ConfigurationTarget.Global);
  });

  test('Listen on a chat answer reads its Markdown as prose', async () => {
    await run('listenText', '**Short** answer. With `code`.');
    assert.equal(lastSpeak(api)?.text, 'Short answer.');
  });
});
