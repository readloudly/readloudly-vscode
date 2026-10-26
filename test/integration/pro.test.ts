import assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface Api {
  status(): string;
  testSession(s: { access: string; email: string }): Thenable<void>;
  testDisclosed(): Thenable<void>;
  sent(): { type: string; text?: string; voice?: string }[];
}

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: string;
}

const run = (id: string) => vscode.commands.executeCommand(`readloudly.${id}`);
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
};

suite('ReadLoudly voices', () => {
  let api: Api;
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  const folder = () => vscode.workspace.workspaceFolders![0]!.uri;
  const clipCalls = () => calls.filter((c) => c.url.endsWith('/voices') && c.method === 'POST');

  async function select(file: string, line: number) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder(), file));
    const editor = await vscode.window.showTextDocument(doc);
    const range = doc.lineAt(line).range;
    editor.selection = new vscode.Selection(range.start, range.end);
  }

  suiteSetup(async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // The extension host shares fetch with VS Code's own services, so only ReadLoudly calls are stubbed.
      if (!/^https:\/\/(api.readloudly.com|attacker.example)\//.test(url))
        return realFetch(input, init);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        auth: new Headers(init?.headers).get('authorization'),
        body: String(init?.body ?? ''),
      });
      if (url.endsWith('/usage')) return Response.json({ totalActivePoints: 1200 });
      return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
        headers: { 'content-type': 'audio/mpeg' },
      });
    }) as typeof fetch;
    api = (await vscode.extensions.getExtension('readloudly.readloudly-vscode')!.activate()) as Api;
    await api.testSession({ access: 'test-token', email: 'reader@example.com' });
    await api.testDisclosed();
    await vscode.workspace
      .getConfiguration('readloudly')
      .update('voice', 'rl:voice-1', vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await run('stop');
    await vscode.workspace
      .getConfiguration('readloudly')
      .update('voice', undefined, vscode.ConfigurationTarget.Global);
    globalThis.fetch = realFetch;
  });

  test('a file matching neverSendGlobs is never sent, the device voice reads it', async () => {
    const from = api.sent().length;
    await select('server.pem', 0);
    await run('readSelection');
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(
      calls.map((c) => c.method + ' ' + c.url),
      []
    );
    const engine = api.sent().slice(from);
    assert.ok(!engine.some((m) => m.type === 'play'), 'a ReadLoudly clip was played');
    const speak = engine.find((m) => m.type === 'speak');
    assert.equal(
      speak?.text,
      'This file stands in for a private key, so ReadLoudly must never send it.'
    );
    assert.equal(speak?.voice, '');
    await run('stop');
  });

  test('a ReadLoudly voice sends the token only to the user-level API, never a workspace one', async () => {
    const from = api.sent().length;
    await select('sample.md', 2);
    await run('readSelection');
    await until(() =>
      api
        .sent()
        .slice(from)
        .some((m) => m.type === 'play')
    );
    const [first] = clipCalls();
    assert.ok(first, 'no clip was requested');
    assert.equal(first.url, 'https://api.readloudly.com/voices');
    assert.equal(first.auth, 'Bearer test-token');
    assert.deepEqual(JSON.parse(first.body), {
      Text: 'ReadLoudly reads this file aloud.',
      VoiceId: 'voice-1',
    });
    assert.ok(
      api
        .sent()
        .slice(from)
        .some((m) => m.type === 'play'),
      'the clip never reached the player'
    );
    await run('stop');
  });
});
