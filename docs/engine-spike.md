# M0 engine spike

Status: macOS done (2026-10-25), automated probes and the window checks. Windows, Linux, Cursor and
Windsurf are still open (see the bottom of this file).

How it was run: `spike/` is a throwaway extension, never packaged. `spike/run.sh` opens a clean VS
Code profile with it loaded; on start it runs every probe and writes `spike/results/<platform>.json`.
`AUTOQUIT_MS=8000 spike/run.sh` quits on its own after the probes. On Windows, run
`code --user-data-dir %TEMP%\rl-spike --extensionDevelopmentPath=<repo>\spike --disable-extensions --new-window`.

The window checks need no person: `spike/run.sh --remote-debugging-port=9333`, then `node spike/cdp.mjs`
with `audio`, `minsize`, `geom`, `bounds`, `set <l> <t> <w> <h>` or `quit`. `swift spike/drag.swift x y dx dy`
sends a real macOS mouse drag and puts the cursor back. `RESTORE=1 spike/run.sh` only restores the panel.

## macOS 27.0.1, VS Code 1.143.0 (raw: `spike/results/darwin.json`)

| Question                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `speechSynthesis` voices in a webview     | Yes: 180 local voices after 134 ms. Speech starts 49 ms after `speak()`; `onboundary` fired 9 times for a 7-word sentence. No click needed.                                                                                                                                                                                                                                                                                                                      |
| 2. MP3 Blob in `<audio>` with `playbackRate` | Decodes (6.11 s, `preservesPitch` true), but `play()` is refused with `NotAllowedError` until the webview gets a click, even when muted. `AudioContext` stays `suspended` too.                                                                                                                                                                                                                                                                                   |
| 2a. After a click                            | Plays at a true 1.5x: 4079-4166 ms against 4077 ms expected (a real click and a CDP gesture gave the same result).                                                                                                                                                                                                                                                                                                                                               |
| 2b. Later clip, no click                     | A **new** `Audio()` is still refused, even with `userActivation.hasBeenActive` true: the policy is per element. The **same** element unlocked in the click plays a new `src` fine, and an `AudioContext` created in the click stays `running`.                                                                                                                                                                                                                   |
| 2c. Host-side MP3 (`afplay -r 1.5`)          | Plays from the extension host with no click: 5.06 s for a 6.11 s clip (about 4.1 s of audio plus about 1 s of start-up).                                                                                                                                                                                                                                                                                                                                         |
| 3. OS engine per sentence (`say`)            | `execFile` spawns in 2-10 ms; a 7-word sentence takes 4.0-4.5 s end to end. No way to measure time to first sound from the host.                                                                                                                                                                                                                                                                                                                                 |
| 4a. Floating window commands                 | `moveEditorToNewWindow`, `enableCompactAuxiliaryWindow` and `enableWindowAlwaysOnTop` all ran without error.                                                                                                                                                                                                                                                                                                                                                     |
| 4b. Webview after the move                   | Still answers messages, but its page reloaded (2 boots): moving a panel to a new window resets webview state even with `retainContextWhenHidden`.                                                                                                                                                                                                                                                                                                                |
| 4c. Smallest floating window                 | **400 x 270.** Asking for 340 x 80 or 100 x 40 gives 400 x 270. It is VS Code's own floor for every window (`WindowMinimumSize = { WIDTH: 400, HEIGHT: 270 }` in the shipped `mainImpl.js`); an extension cannot change it.                                                                                                                                                                                                                                      |
| 4d. Drag the pill to move the window         | **No.** The pill has `app-region: drag`, yet a real mouse drag on it left the window where it was. The same drag on the compact window's 32 px title strip moved it (control).                                                                                                                                                                                                                                                                                   |
| 4e. Restore after quit and relaunch          | **Size yes, place not always**, and only with a `WebviewPanelSerializer` (without one the panel is dropped). Run 1: back at the exact place and size (640, 220, 480 x 320), still compact and on top (window layer 3). Run 2: size kept (480 x 320) but the place moved from (1032, 200) to (1127, 374). Run 3, window never moved: it came back at 400 x 270 at a new place. Extensions have no API to set window bounds, so the player cannot fix this itself. |
| 4f. Real OS click vs CDP gesture             | Same result: a real mouse click on the button (which also proves the screen math used for 4d) played at 1.5x (4111 ms), and the replay gave fresh `NotAllowedError`, reused element `ok`, kept context `running`.                                                                                                                                                                                                                                                |

## What this means for M1 and M2

- **Device voices (M1): webview `speechSynthesis` on macOS.** It needs no click, starts in under
  50 ms and gives word boundaries. `say` stays the fallback if a platform has no webview voices.
- **The player keeps all state in the extension host.** The webview reloads when moved to the floating
  window, so it renders from a state message the host sends on every `boot`.
- **The floating player is a 400 x 270 mini window, not a 340 x 80 pill.** The window is moved by its
  title strip, not by the pill. The pill design stays, laid out inside that window; this changes the
  approved mockup and needs the owner's sign-off.
- **Register a `WebviewPanelSerializer` in M1.** Without it the floating player is not restored at all;
  with it the size comes back, the place usually but not always.
- **Pro voices (M2): one `AudioContext` in the webview, unlocked by the first click on the player.** Later
  clips started from commands or shortcuts then play with no click. After a reload (the move to the
  floating window, or a restore) the next click unlocks it again. Host playback (`afplay`) is the fallback
  and needs players probed on Windows and Linux.

## Open: needs another OS or editor

- [ ] Windows: same run; also probe PowerShell `System.Speech` (built in) and host MP3 playback.
- [ ] Linux: same run; `spd-say` and a host MP3 player.
- [ ] Cursor and Windsurf (not installed on the test Mac).
