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

- M0 engine spike: macOS done (probes and window checks); Windows, Linux, Cursor, Windsurf open. Report:
  `docs/engine-spike.md`. The product scaffold (TypeScript, esbuild, lint, tests) starts with M1.
- `spike/` is throwaway probe code: never packaged, never imported by `src/`. `spike/run.sh` opens a
  clean VS Code profile with it and writes `spike/results/<platform>.json`.

## Gotchas found so far

- **Webview audio needs a click, per element.** An MP3 Blob in `<audio>` (even muted) and `AudioContext`
  are blocked until a user gesture, and every **new** element is blocked again. Unlock one `AudioContext`
  (or one element) in the click and reuse it. `speechSynthesis` is not blocked.
- **Floating windows are at least 400 x 270** (VS Code's `WindowMinimumSize`), and `app-region: drag`
  inside a webview does nothing: the window moves only by its title strip.
- **Restoring the floating player needs a `WebviewPanelSerializer`**; with one, VS Code restores its size,
  compact mode and on-top, but the position drifted in 1 of 2 runs (no extension API to set bounds).
- **Moving a panel to a floating window reloads its webview**, even with `retainContextWhenHidden`. Keep
  player state in the extension host and re-send it on the webview's `boot` message.
- **Launching VS Code from a shell inside VS Code** inherits `ELECTRON_RUN_AS_NODE=1` (VS Code starts
  as plain Node and exits) and a long `--user-data-dir` breaks the IPC socket on macOS (104-char limit).
  `spike/run.sh` handles both with `env -i` and `/tmp/rl-spike-profile`.
- **OS speech commands** take the text as one argv entry (`say`, `spd-say`) or an env var (PowerShell),
  through `execFile` — never a shell string.

## Contracts it consumes

Backend REST only (Bearer, like readloudly-native): `POST /auth/login`, `POST /auth/refresh` (cookie),
`GET /voices`, `POST /voices` (MP3 + `X-Credit-Usage`), credit/plan reads. Web deep links
`/dashboard/?url=` and `/viewer/tts/d/?text=` (same as rl-chrome-extension). Nothing depends on this repo.
