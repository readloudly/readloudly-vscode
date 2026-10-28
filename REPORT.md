# A11y Verification Report

> Versioned project record (A11Y.md §2). Legend: `[x]` verified with evidence · `[!]` verified and failed · `[~]` partial · `[ ]` not verified, reason given.

---

## 📌 Validation Context
- **Feature/Epic:** the player webview in the Explorer (`src/player/panel.ts` markup and CSS, `src/webview/player.ts` behaviour). VS Code's own UI (CodeLens, commands, status bar) is out of scope.
- **Test Date:** 10/28/2026
- **Standard version:** 2.5.0
- **Compliance Status:** ⚠️ CONDITIONAL
- **Verification Independence:** self-reported (Claude Code, code read; no assistive technology run)
- **Static gate (`verify-a11y.py`):** before FAIL (1 error: this report missing); after PASS (0 errors, 4 warnings). The gate pattern-matches JSX, so the audit below is a manual read of the template string. *Run on: 2026-10-28.*

## 1. Technical Verification (Automated & Semantics)
- [ ] **Axe-Core / Lighthouse:** not run; needs the Extension Development Host. _Who: QA._
- [x] **HTML Semantics:** every control is a native `<button>` or `<select>`; icon buttons have `aria-label`; SVGs are `aria-hidden`; the bar is `role="toolbar"` with a name; the voice select has a visually hidden `<label>`.
- [x] **Headings:** none needed (one-row panel inside a VS Code view that already has a title).

## 2. Tab Order and Focus Management
- [x] **Focus Indicator:** `outline: 2px solid var(--vscode-focusBorder)` on `:focus-visible`, so it follows every theme, high contrast included.
- [~] **Logical Navigation:** DOM order matches visual order (code read). Not tabbed through.
- [x] **Captured Focus:** no modal; the panel never steals focus from the editor.

## 3. Behavior and Task Return
- [ ] **Screen Reader Test:** not run. _Who: owner or QA, VoiceOver + VS Code: `guide-buttons` (player toolbar), `guide-toasts-notifications` (note line), `guide-form-controls` (voice select)._
- [x] **Status Change (`aria-live`):** fixed, see Note 1. Errors and hints stay in the polite `#note` region.
- [~] **Voice Control:** names match visible tooltips, except Speed (Note 3).
- [x] **Interactive states:** Play/Pause updates its `aria-label` (`player.ts:225`); Previous/Next are `disabled` when the queue is empty.

## 4. Visual Perception and Comprehension
- [!] **UI Contrast:** text and focus colours come from `--vscode-*` theme tokens and pass with the theme. The white play icon on the brand gradient fails at the light end (Note 2).
  | Pair | Foreground | Background | Ratio | Floor | Result |
  | :--- | :--- | :--- | ---: | ---: | :--- |
  | play icon, gradient start | #ffffff | #fb923c | 2.26:1 | 3:1 | ❌ |
  | play icon, gradient end | #ffffff | #ff5a1f | 3.12:1 | 3:1 | ✅ |
- [x] **Redundancy:** play state is icon + accessible name.
- [x] **Motion:** the ripple and scale transitions stop under `prefers-reduced-motion`.

## 5. Time-Based Media and Motion
- Speech is user-started only. No video.

## 6. Cognitive Load and Flow
- N/A: one toolbar, no forms or time limits.

---
## 📝 Assessment Notes or Known Blockers

- **Note 1 (high, fixed):** `#now` was `aria-live="polite"` and is rewritten for every spoken sentence, so a screen reader would read each sentence over the extension's own speech. The live region is removed from `#now` (`panel.ts`); `#note` keeps it for errors and hints.
- **Note 2 (owner decision, a11y vs design):** same brand "live" orange as the Chrome extension: white icon on `#fb923c` is 2.26:1 (SC 1.4.11 needs 3:1). Darkening the start to about `#ea580c` passes; not changed.
- **Note 3 (medium, not fixed):** the Speed chip shows "1×" but its name is "Playback speed" (SC 2.5.3 label in name). Shift+click for slower also works with Shift+Enter/Space, since keyboard activation carries the modifier.
- **Checks:** `npm run typecheck`, `npm run lint`, `npm run build` exit 0; `npm test` 68/68.
