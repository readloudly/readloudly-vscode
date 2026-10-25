# M0 engine spike

Status: macOS automated probes done (2026-10-25). Manual window checks, Windows, Linux, Cursor and
Windsurf are still open (see the bottom of this file).

How it was run: `spike/` is a throwaway extension, never packaged. `spike/run.sh` opens a clean VS
Code profile with it loaded; on start it runs every probe and writes `spike/results/<platform>.json`.
`AUTOQUIT_MS=8000 spike/run.sh` quits on its own after the probes. On Windows, run
`code --user-data-dir %TEMP%\rl-spike --extensionDevelopmentPath=<repo>\spike --disable-extensions --new-window`.

## macOS 27.0.1, VS Code 1.143.0 (raw: `spike/results/darwin.json`)

| Question | Result |
|---|---|
| 1. `speechSynthesis` voices in a webview | Yes: 180 local voices after 134 ms. Speech starts 49 ms after `speak()`; `onboundary` fired 9 times for a 7-word sentence. No click needed. |
| 2. MP3 Blob in `<audio>` with `playbackRate` | Decodes (6.11 s, `preservesPitch` true), but `play()` is refused with `NotAllowedError` until the webview gets a click, even when muted. `AudioContext` stays `suspended` too. Autoplay feature policy reports allowed; the block is the missing user activation. |
| 2b. Host-side MP3 (`afplay -r 1.5`) | Plays from the extension host with no click: 5.06 s for a 6.11 s clip (about 4.1 s of audio plus about 1 s of start-up). |
| 3. OS engine per sentence (`say`) | `execFile` spawns in 2-10 ms; a 7-word sentence takes 4.0-4.5 s end to end. No way to measure time to first sound from the host. |
| 4a. Floating window commands | `moveEditorToNewWindow`, `enableCompactAuxiliaryWindow` and `enableWindowAlwaysOnTop` all ran without error. |
| 4b. Webview after the move | Still answers messages, but its page reloaded (2 boots): moving a panel to a new window resets webview state even with `retainContextWhenHidden`. |

## What this means for M1 and M2

- **Device voices (M1): webview `speechSynthesis` on macOS.** It needs no click, starts in under
  50 ms and gives word boundaries. `say` stays the fallback if a platform has no webview voices.
- **The player keeps all state in the extension host.** The webview reloads when moved to the floating
  window, so it renders from a state message the host sends on every `boot`.
- **Pro voices (M2) cannot rely on webview autoplay.** Playback started from a command or shortcut has
  no click in the webview. Two candidate paths, to settle with the manual check below:
  1. Webview audio after one click on the pill's play button, if the activation sticks for later clips.
  2. Host-side playback (`afplay` on macOS); Windows and Linux players still need probing.

## Open: needs a person (macOS) or another OS

Run `spike/run.sh` (no `AUTOQUIT_MS`), then in the floating "ReadLoudly Spike" window:
- [ ] Click "Manual check: click to play the MP3 at 1.5x". Does it play, and does it sound 1.5x? (The
      result is also saved as `manualAfterClick` in the results file.)
- [ ] Can the window be resized down to about 340 x 80?
- [ ] Does dragging the pill (not the title bar) move the window?
- [ ] Move and resize the window, quit VS Code, run `spike/run.sh` again: does it reopen at the same place and size?
- [ ] Windows: same run; also probe PowerShell `System.Speech` (built in) and host MP3 playback.
- [ ] Linux: same run; `spd-say` and a host MP3 player.
- [ ] Cursor and Windsurf (not installed on the test Mac).
