## 2026-10-25 M0 macOS window checks

- Driven over CDP (`spike/cdp.mjs`) plus a real mouse drag (`spike/drag.swift`); no owner clicks.
- Floating window floor 400x270; webview `app-region: drag` ignored; serializer restores bounds, compact, on top.
- Webview MP3: new Audio() needs a gesture each time; an AudioContext unlocked by one click keeps playing.
