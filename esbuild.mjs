import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2023' };
const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/webview/player.ts'],
    outfile: 'media/player.js',
    platform: 'browser',
    format: 'iife',
  },
  {
    ...common,
    entryPoints: ['test/integration/extension.test.ts'],
    outfile: 'dist/test/extension.test.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode', 'mocha'],
  },
];

for (const options of builds) {
  if (watch) await (await esbuild.context(options)).watch();
  else await esbuild.build(options);
}
