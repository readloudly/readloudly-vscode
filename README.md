# ReadLoudly: Read Aloud

Listen to code comments, docs, Markdown and AI answers in VS Code, with the spoken sentence and
word highlighted in the editor. Device voices are free, need no account and never send text
anywhere.

## Use it

Click any line, or select text: the player appears right above it with **Listen**, **Pause**,
**Back**, **Next**, **Stop**, **Speed** and **Voice**.

| Command                                                    | macOS                  | Windows / Linux        |
| ---------------------------------------------------------- | ---------------------- | ---------------------- |
| Read Selection (reads from the cursor if nothing selected) | `Ctrl+Shift+Cmd+R`     | `Ctrl+Shift+Alt+R`     |
| Pause/Resume                                               | `Ctrl+Shift+Cmd+Space` | `Ctrl+Shift+Alt+Space` |

The same read shortcut works on text selected in Chat, the terminal, hovers and webviews (it copies
the selection, reads it and puts your clipboard back).

Also in the Command Palette under **ReadLoudly**: Read File, Read from Cursor, Read Clipboard,
Stop, Next/Previous Sentence, Faster, Slower, Choose Voice, Export as MP3, Open in ReadLoudly Web,
Sign In and Sign Out. The right-click menu has the read commands and a **ReadLoudly AI** submenu.

Markdown is read as prose: link text is read but URLs are not, and code blocks are skipped
(`readloudly.skipCodeBlocks`). In a Jupyter notebook, put the cursor in a Markdown cell and run
Read File.

### Voices

- **Device voices**: your operating system's voices. Free and offline.
- **Kokoro voices**: a natural neural voice that runs on your own CPU or GPU. The model downloads
  once from the Hugging Face CDN the first time you choose it; your text never leaves the machine.
- **ReadLoudly voices**: cloud voices from your ReadLoudly account. Sign in from the voice picker or
  with **ReadLoudly: Sign In**. They use your ReadLoudly credits, and **Export as MP3** saves a
  selection or file as an audio file.

The voice engine runs in the **ReadLoudly** section of the Explorer. Browsers block sound until
you click inside them once, so the first Kokoro or ReadLoudly voice in a session may ask you to
click **Turn on sound** there.

### AI, then listen

**Summarize**, **Translate…**, **Explain** and **Simplify and Listen** send the selection (or the
file) to your VS Code language model, for example GitHub Copilot. The answer streams into a
document beside your text and is read aloud. A translation is read by a voice in that language
when one is installed.

In Chat, use `@readloudly` with `/summarize`, `/translate Spanish`, `/explain`, `/simplify` or
`/read`; each answer has a **Listen** button. In agent mode, the `#readAloud` tool lets the agent
read text to you.

Without a language model (for example in Cursor or Windsurf, or without Copilot), the AI commands
say so and the rest of the extension works as before.

## Settings

| Setting                     | Default                        | What it does                                     |
| --------------------------- | ------------------------------ | ------------------------------------------------ |
| `readloudly.voice`          | system default                 | Voice; pick one with Choose Voice.               |
| `readloudly.speed`          | `1`                            | 0.75, 1, 1.25, 1.5 or 2.                         |
| `readloudly.followAlong`    | `true`                         | Scroll to keep the spoken sentence in view.      |
| `readloudly.skipCodeBlocks` | `true`                         | Skip fenced code blocks in Markdown.             |
| `readloudly.highlightColor` | `readloudly.sentenceHighlight` | Theme color id for the spoken sentence.          |
| `readloudly.lineControls`   | `true`                         | Show the player above the line you click.        |
| `readloudly.neverSendGlobs` | `.env*`, keys, `*secret*`      | Files that are never sent to ReadLoudly.         |
| `readloudly.apiUrl`         | `https://api.readloudly.com`   | ReadLoudly API; change only for a test server.   |
| `readloudly.webUrl`         | `https://app.readloudly.com`   | ReadLoudly web app, for credits and Open in Web. |

## Privacy

- **Device and Kokoro voices** never send your text anywhere.
- **ReadLoudly voices** send each sentence you play (or export) to `readloudly.apiUrl` to make the
  audio. You see a notice the first time, and nothing is sent until you accept it. Audio is cached
  on ReadLoudly's servers by its text and voice, and that cache is shared: anyone who reads the
  same text with the same voice gets the cached audio. Files matching `readloudly.neverSendGlobs`
  (`.env`, `.pem`, `.key`, `id_rsa`, `*secret*`, `.p12` by default) are never sent; the device voice
  reads them instead.
- **AI commands** send the selection or file to the language model you use in VS Code, under that
  model's own terms. VS Code asks for your permission the first time.
- **Open in ReadLoudly Web** puts up to 2,000 characters of the selection in the web address it
  opens.
- Your sign-in is kept in VS Code's secret storage, never in settings or logs. The extension
  collects no telemetry.

## Known limits

- Verified on macOS with VS Code 1.143 and Antigravity. Windows and Linux voices, Cursor and
  Windsurf are not verified yet.
- VS Code does not let extensions draw over the editor, so the controls live in a row above the
  line instead of a floating player.
- Sign-in is email and password; Google sign-in is not supported yet.

## Development

```sh
npm install
npm run build              # dist/extension.js, media/player.js, media/kokoro.js
npm test                   # unit tests (node:test)
npm run test:integration   # runs in VS Code; VSCODE_PATH=<Code binary> reuses an installed one
npm run lint && npm run typecheck
npm run package            # builds the .vsix
```

Press F5 with this folder open to start an Extension Development Host. `python3
scripts/icons.py <MaterialSymbolsRounded.ttf>` rebuilds `media/icons.woff`.
