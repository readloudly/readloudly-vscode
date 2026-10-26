import * as esbuild from 'esbuild';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants as zlib } from 'node:zlib';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2023' };
// Kokoro downloads its model and voices from the moving `main` branch, so the build pins one Hugging Face commit.
const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const PINS = [
  ['kokoro-js/dist/kokoro.js', '/resolve/main/voices/', `/resolve/${KOKORO_REVISION}/voices/`],
  ['transformers/dist/transformers.web.js', '/resolve/{revision}/', `/resolve/${KOKORO_REVISION}/`],
];
const pinKokoro = {
  name: 'pin-kokoro',
  setup(build) {
    build.onLoad({ filter: /(kokoro|transformers)(\.web)?\.js$/ }, ({ path }) => {
      const pin = PINS.find(([file]) => path.replaceAll('\\', '/').endsWith(file));
      if (!pin) return undefined;
      const source = readFileSync(path, 'utf8');
      if (!source.includes(pin[1]))
        throw new Error(`${pin[0]} changed; update PINS in esbuild.mjs`);
      return { contents: source.replaceAll(pin[1], pin[2]), loader: 'js' };
    });
  },
};
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
    plugins: [pinKokoro],
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

// ONNX Runtime ships in media/ instead of a CDN; its 21 MB wasm is brotli-packed and unpacked by src/player/wasm.ts.
const ORT = 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep';
copyFileSync(`${ORT}.mjs`, 'media/ort-wasm-simd-threaded.jsep.mjs');
rmSync('media/ort-wasm-simd-threaded.jsep.wasm', { force: true });
const wasm = readFileSync(`${ORT}.wasm`);
writeFileSync(
  'media/ort-wasm-simd-threaded.jsep.wasm.br',
  brotliCompressSync(wasm, {
    params: {
      [zlib.BROTLI_PARAM_QUALITY]: zlib.BROTLI_MAX_QUALITY,
      [zlib.BROTLI_PARAM_LGWIN]: zlib.BROTLI_MAX_WINDOW_BITS,
      [zlib.BROTLI_PARAM_SIZE_HINT]: wasm.length,
    },
  })
);
for (const options of builds) {
  if (watch) await (await esbuild.context(options)).watch();
  else await esbuild.build(options);
}
