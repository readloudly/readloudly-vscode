import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskMarkdown, maskPlain } from './mask.ts';
import { splitSentences } from './sentences.ts';

const md = (src: string, skipCode = true) =>
  splitSentences(maskMarkdown(src, skipCode)).map((s) => s.text);
const plain = (src: string) => splitSentences(maskPlain(src)).map((s) => s.text);

test('masks keep the source length so offsets map 1:1', () => {
  const src =
    '---\na: 1\n---\n# Hi\n\nSee [docs](https://x.io) and **bold**.\n```js\nx()\n```\n- item\n';
  assert.equal(maskMarkdown(src, true).length, src.length);
  assert.equal(maskMarkdown(src, false).length, src.length);
  assert.equal(maskPlain('a\nb\r\nc').length, 'a\nb\r\nc'.length);
});

test('reads a heading as its own sentence', () => {
  assert.deepEqual(md('# Getting started\nBody text here.'), [
    'Getting started',
    'Body text here.',
  ]);
});

test('skips fenced code by default and reads it when asked', () => {
  const src = 'Intro.\n```js\nconst x = 1;\n```\nOutro.';
  assert.deepEqual(md(src), ['Intro.', 'Outro.']);
  assert.deepEqual(md(src, false), ['Intro.', 'const x = 1;', 'Outro.']);
});

test('reads link text but not the URL, and keeps link text offsets', () => {
  const src = 'See [the docs](https://x.io/a) now.';
  const [s] = splitSentences(maskMarkdown(src, true));
  assert.equal(s?.text, 'See the docs now.');
  assert.equal(src.slice(s!.start, s!.start + 3), 'See');
  assert.deepEqual(md('Visit https://example.com/x?y=1 today.'), ['Visit today.']);
});

test('joins the lines of one paragraph into one sentence', () => {
  assert.deepEqual(md('This is a long\nsentence over two lines.'), [
    'This is a long sentence over two lines.',
  ]);
});

test('reads each list item separately', () => {
  assert.deepEqual(md('- first item\n- [x] second item\n1. third item'), [
    'first item',
    'second item',
    'third item',
  ]);
});

test('strips emphasis but keeps snake_case and inline code text', () => {
  assert.deepEqual(md('**Bold** and _soft_ keep my_var and `npm test`.'), [
    'Bold and soft keep my_var and npm test.',
  ]);
});

test('skips front matter, tables rules and HTML tags', () => {
  assert.deepEqual(md('---\ntitle: x\n---\nHello <b>there</b>.\n\n---\n| a | b |\n|---|---|'), [
    'Hello there.',
    'a b',
  ]);
});

test('plain text joins a wrapped line only when the next one continues in lowercase', () => {
  assert.deepEqual(plain('One line that\ncontinues here.'), ['One line that continues here.']);
  assert.deepEqual(plain('First line\nSecond line'), ['First line', 'Second line']);
});
