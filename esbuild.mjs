import * as esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';

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
    entryPoints: ['src/webview/kokoro.ts'],
    outfile: 'media/kokoro.js',
    platform: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: false,
  },
  {
    ...common,
    entryPoints: ['test/integration/*.test.ts'],
    outdir: 'dist/test',
    platform: 'node',
    format: 'cjs',
    external: ['vscode', 'mocha'],
  },
];

// ONNX Runtime loads its WebAssembly from media/ (kokoro.ts sets wasmPaths) instead of a CDN.
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'])
  copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `media/${f}`);
for (const options of builds) {
  if (watch) await (await esbuild.context(options)).watch();
  else await esbuild.build(options);
}
