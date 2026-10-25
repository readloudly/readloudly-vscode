import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from './sentences.ts';

const spans = (s: string, base = 0) => splitSentences(s, base).map((x) => [x.text, x.start, x.end]);

test('splits sentences and keeps their source offsets', () => {
  assert.deepEqual(spans('Hello world. Second one here.'), [
    ['Hello world.', 0, 12],
    ['Second one here.', 13, 29],
  ]);
});

test('adds the base offset of the slice', () => {
  assert.deepEqual(spans('A b. C d.', 100), [
    ['A b.', 100, 104],
    ['C d.', 105, 109],
  ]);
});

test('does not break after "e.g." or inside decimals', () => {
  const s = 'Use tools, e.g. a hammer, carefully. Pi is 3.14 today. Done.';
  assert.deepEqual(
    splitSentences(s).map((x) => x.text),
    ['Use tools, e.g. a hammer, carefully.', 'Pi is 3.14 today.', 'Done.']
  );
});

test('splits CJK on the ideographic full stop', () => {
  assert.deepEqual(spans('你好。世界很大。'), [
    ['你好。', 0, 3],
    ['世界很大。', 3, 8],
  ]);
});

test('counts emoji in UTF-16 units, like editor offsets', () => {
  assert.deepEqual(spans('Great 👍. Next.'), [
    ['Great 👍.', 0, 9],
    ['Next.', 10, 15],
  ]);
});

test('drops segments with no letters or digits', () => {
  assert.deepEqual(spans('   \n\n  ... '), []);
});

test('collapses inner whitespace in the spoken text but not in the range', () => {
  assert.deepEqual(spans('Hello   big\tworld.'), [['Hello big world.', 0, 18]]);
});
