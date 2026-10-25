# CLAUDE.md — readloudly-vscode

> Service-local memory for the ReadLoudly VS Code extension. The workspace root `../CLAUDE.md` and
> `.claude/rules/*` also apply. This is its **own git repo** (`github.com/readloudly/readloudly-vscode`,
> private) — run git inside this folder.

## Session log (append-only)

At the end of a work session here, append a dated entry of ≤5 lines to `PROGRESS_STATUS.md` with
`cat >> PROGRESS_STATUS.md <<'EOF'`.

## What this repo is

"ReadLoudly: Read Aloud" for VS Code (publisher `readloudly`, id `readloudly.readloudly-vscode`).
Listen to a selection, a file, Markdown, a notebook cell or the clipboard with the spoken sentence
highlighted in the editor. Device voices are free and never send text anywhere; Pro voices call the
backend; AI actions (summarize, translate, explain, simplify) use the person's `vscode.lm` model.

The binding plan is `../docs/vscode-extension-build-prompt-2026-10-25.md` (milestones M0 to M4, rules,
architecture). The approved review page is https://claude.ai/artifact/4Yh8twMaHcakns9ftbtd9E.

## Status (2026-10-25)

- M0 engine spike: macOS done (`docs/engine-spike.md`); Windows, Linux, Cursor, Windsurf open.
- M1 free reader on `feat/m1-free-reader`: commands, Markdown masking, sentence highlight, Web Speech
  voices, docked player view (`src/player/panel.ts`) + status-bar hover controls. The floating window
  from the plan was dropped (root DECISIONS.md, 2026-10-25). `spike/` is throwaway, never packaged.
- Gates: `npm test` (node:test), `npm run test:integration` (needs `VSCODE_PATH` and `env -i`, see
  below), `npm run lint`, `npm run typecheck`, `npm run package`.

## Gotchas found so far

- **Webview audio needs a click, per element.** An MP3 Blob in `<audio>` (even muted) and `AudioContext`
  are blocked until a user gesture, and every **new** element is blocked again. Unlock one `AudioContext`
  (or one element) in the click and reuse it. `speechSynthesis` is not blocked.
- **The player view's webview is the speech engine.** It must be resolved once (`readloudly.player.focus`,
  then focus goes back to the editor); `retainContextWhenHidden` keeps it speaking when the panel hides.
- **Extensions cannot draw over the editor.** No floating pill over code; a draggable pill is only
  possible inside a webview we own (Reader view, not built).
- **Webview messages:** the player frame accepts only `e.origin === location.origin` (VS Code relays
  from the same-origin host frame); verified in the Extension Development Host.
- **Launching VS Code from a shell inside VS Code** inherits `ELECTRON_RUN_AS_NODE=1` (VS Code starts
  as plain Node and exits) and a long `--user-data-dir` breaks the IPC socket on macOS (104-char limit).
  `spike/run.sh` handles both with `env -i` and `/tmp/rl-spike-profile`.
- **OS speech commands** take the text as one argv entry (`say`, `spd-say`) or an env var (PowerShell),
  through `execFile` — never a shell string.

## Contracts it consumes

Backend REST only (Bearer, like readloudly-native): `POST /auth/login`, `POST /auth/refresh` (cookie),
`GET /voices`, `POST /voices` (MP3 + `X-Credit-Usage`), credit/plan reads. Web deep links
`/dashboard/?url=` and `/viewer/tts/d/?text=` (same as rl-chrome-extension). Nothing depends on this repo.
