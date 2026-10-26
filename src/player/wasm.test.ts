import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { inflateWasm } from './wasm.ts';

const pack = (dir: string, bytes: string) => {
  const p = join(dir, 'engine.wasm.br');
  writeFileSync(p, brotliCompressSync(Buffer.from(bytes)));
  return p;
};

test('unpacks once, reuses the file and drops the previous build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-wasm-'));
  const store = join(dir, 'storage');
  const first = inflateWasm(pack(dir, 'build one'), store);
  assert.equal(readFileSync(first, 'utf8'), 'build one');
  assert.equal(inflateWasm(join(dir, 'engine.wasm.br'), store), first);
  const second = inflateWasm(pack(dir, 'build two'), store);
  assert.notEqual(second, first);
  assert.equal(readFileSync(second, 'utf8'), 'build two');
  assert.deepEqual(readdirSync(store), [second.slice(store.length + 1)]);
});
