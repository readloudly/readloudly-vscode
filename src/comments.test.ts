import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.(ts|mjs)$/.test(e.name)
        ? [join(dir, e.name)]
        : []
  );

test('every comment is a single line (workspace rule)', () => {
  const offenders = [
    ...files('src'),
    ...files('test'),
    'esbuild.mjs',
    'eslint.config.mjs',
    '.vscode-test.mjs',
  ].flatMap((f) => {
    const lines = readFileSync(f, 'utf8').split('\n');
    return lines.flatMap((l, i) => {
      const doubled = /^\s*\/\//.test(l) && /^\s*\/\//.test(lines[i + 1] ?? '');
      const block = /(^|\s)\/\*/.test(l) && !/\*\//.test(l);
      return doubled || block ? [`${f}:${i + 1}`] : [];
    });
  });
  assert.deepEqual(offenders, []);
});
