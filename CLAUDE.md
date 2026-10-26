# CLAUDE.md — readloudly-vscode

> Service-local memory for the ReadLoudly VS Code extension. The workspace root `../CLAUDE.md` and
> `.claude/rules/*` also apply. This is its **own git repo** (`github.com/readloudly/readloudly-vscode`,
> public since 2026-10-26) — run git inside this folder.

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

## Status (2026-10-26)

- M0 engine spike: macOS done (`docs/engine-spike.md`); Antigravity IDE checked; Linux tests pass in Docker (voices unchecked); Windows, Cursor, Windsurf open.
- M1 to M4 built on `feat/m1-free-reader`: CodeLens player above the clicked line/selection, read-anywhere
  shortcut (copies the focused selection), Kokoro on-device voices; ReadLoudly voices (email sign-in, SecretStorage,
  never-send globs, notice, credits, MP3 export); `vscode.lm` AI actions, `@readloudly`, `readloudly_read_aloud` tool;
  Open in Web, walkthrough. Player webview lives in the Explorer (`src/player/panel.ts`); the floating window was
  dropped (root DECISIONS, 2026-10-25). `spike/` is throwaway, never packaged. Not published.
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
- **`apiUrl`/`webUrl` are `application`-scoped** so a cloned repo's workspace settings cannot redirect the
  sign-in token; `test/fixtures/.vscode/settings.json` sets a hostile `apiUrl` to keep that tested.
- **The extension host shares `fetch` with VS Code's own services** (experiment calls); test stubs must
  pass non-ReadLoudly URLs through.
- **Webview messages:** the player frame accepts only `e.origin === location.origin` (VS Code relays
  from the same-origin host frame); verified in the Extension Development Host.
- **Launching VS Code from a shell inside VS Code** inherits `ELECTRON_RUN_AS_NODE=1` (VS Code starts
  as plain Node and exits) and a long `--user-data-dir` breaks the IPC socket on macOS (104-char limit).
  `spike/run.sh` handles both with `env -i` and `/tmp/rl-spike-profile`.
- **Kokoro is pinned at build time.** kokoro-js ignores `revision` and hardcodes `resolve/main/voices`, so
  `esbuild.mjs` (`PINS`) rewrites both URLs to one Hugging Face commit and fails the build if they move.
- **`voice` and `neverSendGlobs` are `application`-scoped too**, so a workspace cannot pick a paid voice or
  empty the never-send list; the fixture's `.vscode/settings.json` tries both.
- **README images need this repo public:** vsce rewrites `media/…` links to `github.com/readloudly/readloudly-vscode/raw/HEAD/…` (so the file must be on `main`); the details view CSP allows only `img-src https: data:`.
- **Reinstalling the same version keeps stale details** (size, date): uninstall first, then install the VSIX.
- **The VSIX stays under 5 MB by brotli-packing ORT's 21 MB jsep wasm** (`esbuild.mjs`); `src/player/wasm.ts` unpacks it once into `globalStorage`, keyed by hash. Never whitelist the raw `.wasm` in `.vscodeignore`.
- **`globalStorageUri` can be `vscode-userdata:`**, so as a webview root it never matches the `file:` request and the wasm gets HTTP 401 ("both async and sync fetching of the wasm failed"); `panel.ts` wraps it in `Uri.file(fsPath)`.
- **Chat input and chat code blocks are editors** (`editorTextFocus` is true), so the read shortcut uses `!inChat` to send them to `readFocused`; the chat input box itself still cannot be read.
- **OS speech commands** take the text as one argv entry (`say`, `spd-say`) or an env var (PowerShell),
  through `execFile` — never a shell string.

## Contracts it consumes

Backend REST only (Bearer, like readloudly-native): `POST /auth/login`, `POST /auth/refresh` (cookie),
`GET /voices`, `POST /voices` (MP3 + `X-Credit-Usage`), credit/plan reads. Web deep links
`/dashboard/?url=` and `/viewer/tts/d/?text=` (same as rl-chrome-extension). Nothing depends on this repo.
