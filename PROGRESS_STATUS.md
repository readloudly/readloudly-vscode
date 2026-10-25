## 2026-10-25 M0 macOS window checks

- Driven over CDP (`spike/cdp.mjs`) plus a real mouse drag (`spike/drag.swift`); no owner clicks.
- Floating window floor 400x270; webview `app-region: drag` ignored; serializer restores bounds, compact, on top.
- Webview MP3: new Audio() needs a gesture each time; an AudioContext unlocked by one click keeps playing.

## 2026-10-25 (M1 player rework)

- Floating player window replaced by a docked ReadLoudly panel view + status-bar hover mini player (owner: the second window looked ugly).
- Webview message origin check added (Semgrep finding); restore after quit and replay verified in an Extension Development Host.
- Gates: 26 unit, 5 integration, lint, tsc, prettier, vsix 8 files. macOS only.
