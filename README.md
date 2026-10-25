# ReadLoudly: Read Aloud

Listen to any text in VS Code with the spoken sentence highlighted in the editor. Reading uses your
device's own voices: it is free, needs no account and works offline.

## Use it

| Command                                                    | macOS                  | Windows / Linux        |
| ---------------------------------------------------------- | ---------------------- | ---------------------- |
| ReadLoudly: Read Selection (reads from the cursor if none) | `Ctrl+Shift+Cmd+R`     | `Ctrl+Shift+Alt+R`     |
| ReadLoudly: Pause/Resume                                   | `Ctrl+Shift+Cmd+Space` | `Ctrl+Shift+Alt+Space` |

Also in the Command Palette: Read File, Read from Cursor, Read Clipboard, Stop, Next Sentence,
Previous Sentence, Faster, Slower, Choose Voice and Show Player. Read Selection, Read from Cursor
and Read File are in the editor's right-click menu too.

The player opens in a small window that stays on top; move it by its top bar. Closing it pauses
reading, and the ReadLoudly item in the status bar brings it back.

Markdown is read as prose: headings and list items are read on their own, link text is read but
URLs are not, and code blocks are skipped (setting `readloudly.skipCodeBlocks`). In a Jupyter
notebook, put the cursor in a Markdown cell and run Read File.

## Settings

| Setting                     | Default                        | What it does                                |
| --------------------------- | ------------------------------ | ------------------------------------------- |
| `readloudly.voice`          | system default                 | Device voice; pick one with Choose Voice.   |
| `readloudly.speed`          | `1`                            | 0.75, 1, 1.25, 1.5 or 2.                    |
| `readloudly.followAlong`    | `true`                         | Scroll to keep the spoken sentence in view. |
| `readloudly.skipCodeBlocks` | `true`                         | Skip fenced code blocks in Markdown.        |
| `readloudly.highlightColor` | `readloudly.sentenceHighlight` | Theme color id for the spoken sentence.     |

## Privacy

- Text you read never leaves your computer: the voices are your operating system's own, played
  inside VS Code. This version makes no network requests at all.
- The extension collects no telemetry.
- ReadLoudly Pro voices and AI features will come later. They will send text to ReadLoudly only
  when you choose them, will show a notice first, and will refuse files that often hold secrets
  (such as `.env` and key files).

## Known limits

- Tested on macOS with VS Code 1.143. Windows and Linux device voices are not verified yet.
- The floating window needs VS Code 1.100 or later; elsewhere the player opens as a tab.
- VS Code does not let a window go below 400 × 270, so the player window cannot be smaller.

## Development

```sh
npm install
npm run build          # dist/extension.js and media/player.js
npm test               # unit tests (node:test)
npm run test:integration   # runs in VS Code; VSCODE_PATH=<Code binary> reuses an installed one
npm run lint && npm run typecheck
npm run package        # builds the .vsix
```

Press F5 with this folder open to start an Extension Development Host. Design notes and the engine
spike: `docs/engine-spike.md`.
