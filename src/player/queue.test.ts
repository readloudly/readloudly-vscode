import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Queue } from './queue.ts';

const loaded = (index = 0) => {
  const q = new Queue<string>();
  q.load(['a', 'b', 'c'], index);
  return q;
};

test('load starts playing at the given index', () => {
  const q = loaded(1);
  assert.equal(q.status, 'playing');
  assert.equal(q.current, 'b');
});

test('an end event for the current token advances', () => {
  const q = loaded();
  assert.equal(q.ended(q.token), true);
  assert.equal(q.current, 'b');
});

test('a stale end event is ignored', () => {
  const q = loaded();
  const stale = q.token;
  q.next();
  assert.equal(q.ended(stale), false);
  assert.equal(q.current, 'b');
});

test('the last end event finishes the queue', () => {
  const q = loaded(2);
  q.ended(q.token);
  assert.equal(q.status, 'ended');
  assert.equal(q.current, 'c');
});

test('pause keeps the sentence and invalidates its end event', () => {
  const q = loaded(1);
  const before = q.token;
  q.pause();
  assert.equal(q.status, 'paused');
  assert.equal(q.ended(before), false);
  q.resume();
  assert.equal(q.status, 'playing');
  assert.equal(q.current, 'b');
  assert.notEqual(q.token, before);
});

test('resume after the end starts over', () => {
  const q = loaded(2);
  q.ended(q.token);
  q.resume();
  assert.equal(q.status, 'playing');
  assert.equal(q.current, 'a');
});

test('previous stops at the first sentence and next at the last one ends', () => {
  const q = loaded();
  q.previous();
  assert.equal(q.current, 'a');
  q.next();
  q.next();
  q.next();
  assert.equal(q.status, 'ended');
});

test('previous after the end pauses on the sentence before the last', () => {
  const q = loaded(2);
  q.ended(q.token);
  q.previous();
  assert.equal(q.status, 'paused');
  assert.equal(q.current, 'b');
  q.resume();
  assert.equal(q.current, 'b');
});

test('stop clears everything', () => {
  const q = loaded(1);
  q.stop();
  assert.equal(q.status, 'idle');
  assert.equal(q.current, undefined);
  assert.equal(q.items.length, 0);
});
