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
