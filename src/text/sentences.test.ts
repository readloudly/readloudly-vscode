import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capLength, splitSentences, wordAt } from './sentences.ts';

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

test('maps a spoken word back to its source range', () => {
  const src = 'Hello   big\tworld.';
  const [s] = splitSentences(src, 10);
  assert.deepEqual(wordAt(s!, 0), [10, 15]);
  assert.deepEqual(wordAt(s!, 6), [18, 21]);
  assert.deepEqual(wordAt(s!, 11), [22, 28]);
});

test('a word before dropped space-punctuation still covers the punctuation', () => {
  const [s] = splitSentences('Go home .');
  assert.equal(s!.text, 'Go home.');
  assert.deepEqual(wordAt(s!, 3), [3, 9]);
});

test('capLength splits long sentences at a clause, keeping source offsets', () => {
  const src = 'One two three, four five six; seven eight.';
  const parts = capLength(splitSentences(src, 10), 20);
  assert.deepEqual(
    parts.map((p) => [p.text, p.start, p.end]),
    [
      ['One two three,', 10, 24],
      ['four five six;', 25, 39],
      ['seven eight.', 40, 52],
    ]
  );
  assert.equal(parts[1]!.map[0], 25);
  assert.ok(parts.every((p) => p.text.length <= 20));
});

test('capLength falls back to a space, then a hard cut, and leaves short sentences alone', () => {
  assert.deepEqual(
    capLength(splitSentences('aaaa bbbb cccc'), 10).map((p) => p.text),
    ['aaaa bbbb', 'cccc']
  );
  assert.deepEqual(
    capLength(splitSentences('abcdefghij'), 4).map((p) => p.text),
    ['abcd', 'efgh', 'ij']
  );
  const short = splitSentences('Short one.');
  assert.deepEqual(capLength(short, 100), short);
});
