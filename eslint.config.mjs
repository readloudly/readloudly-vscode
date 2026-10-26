import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'media/player.js',
      'media/kokoro.js',
      'media/ort-wasm-*',
      'spike',
      '.vscode-test',
      'node_modules',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } }
);
