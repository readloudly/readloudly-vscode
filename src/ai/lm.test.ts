import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CancellationToken, LanguageModelChatMessage } from 'vscode';
import { ask, NO_MODEL } from './lm.ts';
import { leadingLanguage, prompt } from './prompts.ts';

const user = (text: string) => ({ text }) as unknown as LanguageModelChatMessage;
const token = (cancelled = false) =>
  ({
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose() {} }),
  }) as CancellationToken;
const model = (chunks: string[], seen: unknown[] = [], fail?: unknown) => ({
  sendRequest: async (messages: unknown[]) => {
    seen.push(...messages);
    if (fail) throw fail;
    return {
      text: (async function* () {
        yield* chunks;
      })(),
    } as never;
  },
});

test('ask streams every chunk and returns the whole answer', async () => {
  const seen: unknown[] = [];
  const got: string[] = [];
  const out = await ask(
    model(['Hel', 'lo.'], seen),
    user,
    'summarize',
    'Long text',
    undefined,
    token(),
    (c) => got.push(c)
  );
  assert.equal(out, 'Hello.');
  assert.deepEqual(got, ['Hel', 'lo.']);
  assert.match((seen[0] as { text: string }).text, /<text>\nLong text\n<\/text>/);
});

test('ask stops reading the stream once cancelled', async () => {
  const t = { isCancellationRequested: false } as { isCancellationRequested: boolean };
  const out = await ask(
    model(['a', 'b', 'c']),
    user,
    'explain',
    'x',
    undefined,
    t as CancellationToken,
    () => {
      t.isCancellationRequested = true;
    }
  );
  assert.equal(out, 'a');
});

test('ask without a model says a language model is needed', async () => {
  await assert.rejects(
    ask(undefined, user, 'simplify', 'x', undefined, token(), () => {}),
    { message: NO_MODEL }
  );
});

test('ask turns a declined consent into a plain message', async () => {
  await assert.rejects(
    ask(
      model([], [], Object.assign(new Error('x'), { code: 'NoPermissions' })),
      user,
      'summarize',
      'x',
      undefined,
      token(),
      () => {}
    ),
    /not allowed to use the language model/
  );
});

test('translate prompts keep code and name the target language', () => {
  const p = prompt('translate', '`fooBar()` runs', 'Spanish');
  assert.match(p, /into Spanish/);
  assert.match(p, /identifiers/);
});

test('leadingLanguage reads a name or code at the start of a chat message', () => {
  assert.deepEqual(leadingLanguage('to Spanish: Hello there'), {
    lang: { name: 'Spanish', code: 'es' },
    rest: 'Hello there',
  });
  assert.equal(leadingLanguage('ja こんにちは')?.lang.name, 'Japanese');
  assert.equal(leadingLanguage('Hello there'), undefined);
});
