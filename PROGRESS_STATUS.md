## 2026-10-25 M0 macOS window checks

- Driven over CDP (`spike/cdp.mjs`) plus a real mouse drag (`spike/drag.swift`); no owner clicks.
- Floating window floor 400x270; webview `app-region: drag` ignored; serializer restores bounds, compact, on top.
- Webview MP3: new Audio() needs a gesture each time; an AudioContext unlocked by one click keeps playing.

## 2026-10-25 (M1 player rework)

- Floating player window replaced by a docked ReadLoudly panel view + status-bar hover mini player (owner: the second window looked ugly).
- Webview message origin check added (Semgrep finding); restore after quit and replay verified in an Extension Development Host.
- Gates: 26 unit, 5 integration, lint, tsc, prettier, vsix 8 files. macOS only.

## 2026-10-25 — Antigravity IDE and Linux checks

- Antigravity IDE 1.107 (macOS): vsix installs; speech, sentence 1→4, editor highlight, ReadLoudly panel tab, focus kept, speaks with panel hidden (CDP, isolated /tmp profile).
- Linux (Debian bookworm arm64, xvfb, test-electron download): unit + 5 integration tests pass.

## 2026-10-25 (late): line controls legibility

- CodeLens items now carry an icon + verb (Read aloud from here / speed / voice; Pause, Back, Skip, Stop while live); Kokoro voice shows its name, not the raw id.
- Lightbulb action moved to Quick Fix kind so "Read selection aloud" is first (custom kind sat under More Actions). Verified in EDH; 31 unit + 7 integration pass; reinstalled in Antigravity.
- CodeLens color/size is theme-owned (editorCodeLens.foreground, editor.codeLensFontSize); no per-extension override exists.
- Later: lightbulb Code Action removed (VS Code forces a bulb icon by kind); selecting text now puts "▶️ Listen to selection" in the line player row. Lens uses one emoji family (media-control squircles) since CodeLens can't render SVG or colored codicons; en-space padding guarded by ZWSP so VS Code doesn't trim it. 7 integration pass; reinstalled in Antigravity.
- Later: line player uses Material Symbols Rounded (Apache-2.0) via contributes.icons + media/icons.woff (1.9 KB, built by scripts/icons.py from package.json codepoints, glyphs scaled 1.25x to match codicons); every control has a text label. Icons are monochrome by design (font glyphs take the CodeLens theme color).
- Later: readFocused ("Read Selected Text Anywhere") on the same shortcut outside editors: copies with editor.action.clipboardCopyAction (terminal: terminal.copySelection via keybinding args), reads, restores the text clipboard. Verified live on a Chat answer (status "Sentence 1/1"); terminal path unverified. 8 integration pass.

## 2026-10-26 M2 ReadLoudly voices wired

- Sign-in (email/password, SecretStorage only, Accounts menu provider), voice picker with ReadLoudly voices by language, per-read gate (neverSendGlobs, sign-in, one-time notice), credit estimate + balance, 3-clip prefetch, error actions (credits/standard/sign-in/device fallback), Export as MP3 (per-sentence clips concatenated: /voices/download returns an unsigned S3 URL).
- Fixed webview cancel() regression (synth/Kokoro kept speaking after Stop/Next); client refresh returned '' as tokens.
- Gates: 44 unit, 10 integration (new pro.test.ts: blocked file never fetches; Bearer + body on /voices), typecheck, lint. Live EDH vs a local mock API: sign-in, picker, 1 unlock click, MP3 clips play 1→4/4.

## 2026-10-26 M3 + M4

- M3: src/ai/{prompts,lm}.ts (types-only vscode import, 6 unit tests with a fake model), streaming into a read-only `readloudly-ai:` Markdown doc then reading it, translation picks a device voice in the target language, `@readloudly` participant, `readloudly_read_aloud` tool; 3 integration tests (no model, tool, listenText).
- M4: Open in ReadLoudly Web (text ≤2000 / URL / PDF → dashboard upload), 3-step walkthrough, status-bar a11y label, frontend R mark as media/icon.png, README rewrite with privacy, CHANGELOG. vsix 18 files installed in Antigravity.

## 2026-10-26 audit against the build prompt

- Fixed: apiUrl/webUrl application scope (workspace could redirect the token; regression test with hostile fixture), neverSendGlobs now also blocks AI, chat selection and Open in Web, MP3 export capped at 10,000 chars, "Use a Standard Voice" action, chat icon. Icon = frontend favicon logo (logo-icon-black-box-color-white-theme).
- Open: README GIF (private repo breaks Marketplace images), screen-reader pause, Marketplace/Open VSX publish (owner), Windows/Linux/Cursor/Windsurf, real backend + Copilot runs.

## 2026-10-26 reviewer findings closed

- Fixed: voice/neverSendGlobs application scope, agent tool never uses Pro, refresh keeps the session on 5xx, clip cache prune + eviction race, stale index after gate, 8 s speech watchdog, clipboard try/finally, AI notice, Kokoro pinned to HF 1939ad2a (esbuild PINS), player.js.map untracked, sharp override 0.35.5.
- Tests assert on engine messages (`sent()`); fetch spy counts only extension calls. 54 unit, 14 integration on macOS + Linux. Dev-only audit highs remain (vsce msal, mocha diff/serialize-javascript).

## 2026-10-26 README gif + VSIX size

- README gif was broken: vsce rewrites media/demo.gif to this repo's raw/HEAD, which 404s while the repo is private and before the gif is on main. Link kept relative; renders once public.
- VSIX 6.12 MB -> 3.92 MB: ORT jsep wasm shipped brotli-packed, unpacked once into globalStorage (src/player/wasm.ts); WebGPU kept.
- Gates: 55 unit, 14 integration, typecheck, lint green; headless Chromium Kokoro e2e passed (CPU path) incl. negative control.
