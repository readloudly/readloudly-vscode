import { defineConfig } from '@vscode/test-cli';

// VSCODE_PATH reuses an installed VS Code instead of downloading one.
export default defineConfig({
  files: 'dist/test/**/*.test.js',
  workspaceFolder: 'test/fixtures',
  ...(process.env.VSCODE_PATH && { useInstallation: { fromPath: process.env.VSCODE_PATH } }),
  launchArgs: ['--disable-extensions'],
  mocha: { timeout: 20000 },
});
