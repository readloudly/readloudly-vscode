import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clips, estimateCredits, listVoices } from './voices.ts';

test('premium voices cost a credit per character, standard voices a quarter, per request', () => {
  assert.equal(estimateCredits(['abcde', 'abc'], true), 8);
  assert.equal(estimateCredits(['abcde', 'abc'], false), 3);
  assert.equal(estimateCredits([], false), 0);
});

test('listVoices reads every page and marks ReadLoudly voices', async () => {
  const pages: string[] = [];
  const request = async (path: string) => {
    pages.push(path);
    const page = Number(new URL(path, 'http://x').searchParams.get('pg'));
    const doc = {
      Id: `v${page}`,
      Name: `Voice ${page}`,
      LanguageCode: 'en-US',
      IsPremium: page === 2,
    };
    return Response.json({ docs: [doc], totalPages: 2 });
  };
  const voices = await listVoices(request);
  assert.deepEqual(pages, ['/voices?limit=500&pg=1', '/voices?limit=500&pg=2']);
  assert.deepEqual(voices, [
    { name: 'rl:v1', label: 'Voice 1', lang: 'en-US', isDefault: false, premium: false },
    { name: 'rl:v2', label: 'Voice 2', lang: 'en-US', isDefault: false, premium: true },
  ]);
});

test('Clips fetches the current sentence and prefetches the next two', async () => {
  const asked: string[] = [];
  const clips = new Clips(async (text) => {
    asked.push(text);
    return new TextEncoder().encode(text).buffer;
  });
  const texts = ['a', 'b', 'c', 'd', 'e'];
  const first = await clips.get(texts, 0);
  assert.equal(new TextDecoder().decode(first), 'a');
  assert.deepEqual(asked, ['a', 'b', 'c']);
  await clips.get(texts, 1);
  assert.deepEqual(asked, ['a', 'b', 'c', 'd']);
});

test('Clips.cancel aborts every request in flight and forgets them', async () => {
  const signals: AbortSignal[] = [];
  const clips = new Clips(
    (_text, signal) =>
      new Promise((_resolve, reject) => {
        signals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason));
      })
  );
  const pending = clips.get(['a', 'b', 'c'], 0);
  clips.cancel();
  await assert.rejects(pending);
  assert.equal(signals.length, 3);
  assert.ok(signals.every((s) => s.aborted));
});

test('Clips forgets clips the reader has moved past', async () => {
  const asked: string[] = [];
  const clips = new Clips(async (text) => {
    asked.push(text);
    return new ArrayBuffer(1);
  });
  const texts = ['a', 'b', 'c', 'd', 'e', 'f'];
  await clips.get(texts, 0);
  await clips.get(texts, 4);
  await clips.get(texts, 0);
  assert.deepEqual(asked, ['a', 'b', 'c', 'e', 'f', 'a', 'b', 'c']);
});

test('a cancelled clip failing late does not evict the newer clip for the same text', async () => {
  let fail: (e: Error) => void = () => {};
  let calls = 0;
  const clips = new Clips((_text, signal) => {
    calls++;
    if (calls === 1)
      return new Promise((_r, reject) => {
        fail = reject;
        signal.addEventListener('abort', () => undefined);
      });
    return Promise.resolve(new ArrayBuffer(2));
  });
  const first = clips.get(['a'], 0);
  clips.cancel();
  await clips.get(['a'], 0);
  fail(new Error('aborted late'));
  await assert.rejects(first);
  await clips.get(['a'], 0);
  assert.equal(calls, 2);
});
