import * as vscode from 'vscode';
import { Queue } from './player/queue.ts';
import { renderPlayer, VIEW_TYPE, type FromWebview, type Voice } from './player/panel.ts';
import { maskMarkdown, maskPlain } from './text/mask.ts';
import { splitSentences, wordAt, type Sentence } from './text/sentences.ts';
import type { ToWebview } from './webview/player.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const WORDS_PER_SECOND = 2.6;

interface Source {
  uri?: vscode.Uri;
  label: string;
}

export function activate(context: vscode.ExtensionContext) {
  const queue = new Queue<Sentence>();
  const cfg = () => vscode.workspace.getConfiguration('readloudly');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  let source: Source = { label: '' };
  let resumeAt: number | undefined;
  let voices: Voice[] = [];
  let view: vscode.WebviewView | undefined;
  let highlighted: vscode.Range[] = [];
  let boots = 0;
  let decoration = makeDecoration();
  let word: vscode.Range[] = [];
  let lensLine: { uri: string; line: number } | undefined;
  const lensChanged = new vscode.EventEmitter<void>();
  const wordDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('readloudly.wordHighlight'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('readloudly.wordBorder'),
    borderRadius: '3px',
  });

  function makeDecoration() {
    const color = cfg().get<string>('highlightColor') || 'readloudly.sentenceHighlight';
    return vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor(color),
      borderRadius: '2px',
    });
  }

  const post = (message: ToWebview) => void view?.webview.postMessage(message);
  const speed = () => cfg().get<number>('speed', 1);
  const sourceEditors = () =>
    vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.toString() === source.uri?.toString()
    );

  function sync() {
    const s = queue.current;
    const live =
      s && resumeAt === undefined && (queue.status === 'playing' || queue.status === 'paused');
    highlighted = [];
    word = [];
    lensChanged.fire();
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(wordDecoration, []);
      const own = live && editor.document.uri.toString() === source.uri?.toString();
      const ranges = own
        ? [new vscode.Range(editor.document.positionAt(s.start), editor.document.positionAt(s.end))]
        : [];
      if (own) highlighted = ranges;
      editor.setDecorations(decoration, ranges);
    }
    const n = queue.items.length;
    status.text =
      queue.status === 'idle'
        ? '$(unmute) ReadLoudly'
        : `${queue.status === 'playing' ? '$(debug-pause)' : '$(play)'} Sentence ${queue.index + 1}/${n}`;
    status.tooltip = controls(queue.status === 'playing');
    const words = queue.items
      .slice(queue.index)
      .reduce((sum, x) => sum + x.text.split(' ').length, 0);
    post({
      type: 'state',
      status: queue.status,
      index: queue.index,
      total: n,
      speed: speed(),
      secondsLeft: words / WORDS_PER_SECOND / speed(),
      file: source.label,
      sentence: s?.text ?? '',
      voices,
      voice: cfg().get<string>('voice', ''),
    });
  }

  function speak() {
    sync();
    const s = queue.current;
    if (queue.status !== 'playing' || !s) return post({ type: 'cancel' });
    if (!view) return void showPlayer();
    if (cfg().get<boolean>('followAlong', true)) {
      for (const editor of sourceEditors()) {
        const range = new vscode.Range(
          editor.document.positionAt(s.start),
          editor.document.positionAt(s.end)
        );
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }
    post({
      type: 'speak',
      token: queue.token,
      text: s.text,
      rate: speed(),
      voice: cfg().get<string>('voice', ''),
    });
  }

  function sentencesOf(doc: vscode.TextDocument, from: number, to: number) {
    const text = doc.getText();
    const prose =
      doc.languageId === 'markdown'
        ? maskMarkdown(text, cfg().get('skipCodeBlocks', true))
        : maskPlain(text);
    return splitSentences(prose.slice(from, to), from);
  }

  function read(items: Sentence[], index: number, from: Source) {
    if (!items.length)
      return void vscode.window.showInformationMessage(
        'ReadLoudly: there is nothing to read here.'
      );
    source = from;
    resumeAt = undefined;
    queue.load(items, index);
    speak();
  }

  function readDocFrom(doc: vscode.TextDocument, offset: number) {
    const all = sentencesOf(doc, 0, doc.getText().length);
    const index = all.findIndex((s) => s.end > offset);
    if (index < 0)
      return void vscode.window.showInformationMessage(
        'ReadLoudly: there is nothing after the cursor.'
      );
    read(all, index, { uri: doc.uri, label: label(doc) });
  }

  const label = (doc: vscode.TextDocument) => doc.uri.path.split('/').pop() || 'Untitled';
  const editorOrWarn = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
      void vscode.window.showInformationMessage(
        'ReadLoudly: open a file or select some text first.'
      );
    return editor;
  };

  async function showPlayer() {
    if (view) return view.show(true);
    // The view's webview is the speech engine, so it must be resolved once; focus returns to the text after.
    const back = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);
    if (back) await vscode.window.showTextDocument(back.document, back.viewColumn);
  }

  function adopt(v: vscode.WebviewView) {
    view = v;
    renderPlayer(v.webview, context.extensionUri);
    v.onDidDispose(() => {
      view = undefined;
      if (queue.status === 'playing') queue.pause();
      sync();
    });
    v.webview.onDidReceiveMessage((m: FromWebview) => {
      if (m.type === 'boot') {
        boots++;
        speak();
      } else if (m.type === 'voices') {
        voices = m.voices;
        sync();
      } else if (m.type === 'word') {
        const s = queue.current;
        if (m.token !== queue.token || !s) return;
        const [a, b] = wordAt(s, m.charIndex);
        for (const editor of sourceEditors()) {
          word = [new vscode.Range(editor.document.positionAt(a), editor.document.positionAt(b))];
          editor.setDecorations(wordDecoration, word);
        }
      } else if (m.type === 'ended') {
        if (queue.ended(m.token)) speak();
      } else if (m.type === 'error' && m.token === queue.token) {
        queue.pause();
        sync();
        void vscode.window.showWarningMessage(
          `ReadLoudly: the voice stopped (${m.error}). Press play to try again.`
        );
      } else if (m.type === 'voice')
        void cfg().update('voice', m.name, vscode.ConfigurationTarget.Global);
      else if (m.type === 'cmd')
        void vscode.commands.executeCommand(
          `readloudly.${m.cmd === 'toggle' ? 'togglePause' : m.cmd}`
        );
    });
  }

  function togglePause() {
    if (queue.status === 'playing') {
      queue.pause();
      return speak();
    }
    if (resumeAt !== undefined) {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === source.uri?.toString()
      );
      if (doc) return readDocFrom(doc, resumeAt);
    }
    if (queue.items.length) {
      queue.resume();
      return speak();
    }
    return vscode.commands.executeCommand('readloudly.readSelection');
  }

  async function setSpeed(step: number) {
    const i = SPEEDS.indexOf(speed());
    const next = SPEEDS[Math.min(Math.max((i < 0 ? 1 : i) + step, 0), SPEEDS.length - 1)]!;
    await cfg().update('speed', next, vscode.ConfigurationTarget.Global);
  }

  async function chooseVoice() {
    await showPlayer();
    for (let i = 0; i < 30 && !voices.length; i++) await new Promise((r) => setTimeout(r, 100));
    const lang = vscode.env.language.split('-')[0]!;
    const sorted = [...voices].sort(
      (a, b) => Number(b.lang.startsWith(lang)) - Number(a.lang.startsWith(lang))
    );
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'System default', name: '' },
        ...sorted.map((v) => ({ label: v.label ?? v.name, description: v.lang, name: v.name })),
      ],
      {
        placeHolder: voices.length
          ? 'Choose a device voice'
          : 'No device voices found in this editor',
      }
    );
    if (pick) await cfg().update('voice', pick.name, vscode.ConfigurationTarget.Global);
  }

  const voiceLabel = () => {
    const name = cfg().get<string>('voice', '');
    return voices.find((v) => v.name === name)?.label ?? (name || 'System voice');
  };

  // Controls sit above the line the user clicked, so reading starts and steers right where they look.
  const lineControls: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: lensChanged.event,
    provideCodeLenses(doc) {
      if (!cfg().get('lineControls', true) || doc.uri.toString() !== lensLine?.uri) return [];
      const line = Math.min(lensLine.line, doc.lineCount - 1);
      const range = doc.lineAt(line).range;
      const lens = (title: string, command: string, tooltip: string, args?: unknown[]) =>
        new vscode.CodeLens(range, {
          title,
          tooltip,
          command: `readloudly.${command}`,
          arguments: args,
        });
      const live = queue.status === 'playing' || queue.status === 'paused';
      return [
        ...(live
          ? [
              queue.status === 'playing'
                ? lens('$(debug-pause) Pause', 'togglePause', 'Pause')
                : lens('$(play) Resume', 'togglePause', 'Resume'),
              lens('$(debug-step-back)', 'previous', 'Previous sentence'),
              lens('$(debug-step-over)', 'next', 'Next sentence'),
              lens('$(debug-stop)', 'stop', 'Stop'),
            ]
          : []),
        lens('$(unmute) Read from here', 'readFromLine', 'Read aloud from this line', [
          doc.uri,
          line,
        ]),
        lens(`${speed()}×`, 'cycleSpeed', 'Change speed'),
        lens(voiceLabel(), 'chooseVoice', 'Choose voice'),
      ];
    },
  };

  const restartIfPlaying = () => {
    if (queue.status === 'playing') queue.load(queue.items, queue.index);
    speak();
  };

  const commands: Record<string, (...args: never[]) => unknown> = {
    readSelection: () => {
      const editor = editorOrWarn();
      if (!editor) return;
      const { document: doc, selection } = editor;
      if (selection.isEmpty) return readDocFrom(doc, doc.offsetAt(selection.active));
      read(sentencesOf(doc, doc.offsetAt(selection.start), doc.offsetAt(selection.end)), 0, {
        uri: doc.uri,
        label: label(doc),
      });
    },
    readFile: () => {
      const editor = editorOrWarn();
      if (editor)
        read(sentencesOf(editor.document, 0, editor.document.getText().length), 0, {
          uri: editor.document.uri,
          label: label(editor.document),
        });
    },
    readFromCursor: () => {
      const editor = editorOrWarn();
      if (editor) readDocFrom(editor.document, editor.document.offsetAt(editor.selection.active));
    },
    readClipboard: async () =>
      read(splitSentences(maskPlain(await vscode.env.clipboard.readText())), 0, {
        label: 'Clipboard',
      }),
    togglePause,
    stop: () => {
      queue.stop();
      resumeAt = undefined;
      speak();
    },
    next: () => {
      queue.next();
      speak();
    },
    previous: () => {
      queue.previous();
      speak();
    },
    readFromLine: async (uri: vscode.Uri, line: number) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      readDocFrom(doc, doc.offsetAt(new vscode.Position(line, 0)));
    },
    cycleSpeed: () =>
      cfg().update(
        'speed',
        SPEEDS[(SPEEDS.indexOf(speed()) + 1) % SPEEDS.length],
        vscode.ConfigurationTarget.Global
      ),
    faster: () => setSpeed(1),
    slower: () => setSpeed(-1),
    chooseVoice,
    showPlayer,
    statusClick: () => (!view || queue.status === 'idle' ? showPlayer() : togglePause()),
  };

  status.command = 'readloudly.statusClick';
  sync();
  status.show();
  context.subscriptions.push(
    status,
    { dispose: () => decoration.dispose() },
    wordDecoration,
    lensChanged,
    vscode.languages.registerCodeLensProvider({ scheme: '*' }, lineControls),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse || !e.selections[0]!.isEmpty)
        return;
      lensLine = { uri: e.textEditor.document.uri.toString(), line: e.selections[0]!.active.line };
      lensChanged.fire();
    }),
    ...Object.entries(commands).map(([id, run]) =>
      vscode.commands.registerCommand(`readloudly.${id}`, run)
    ),
    vscode.window.registerWebviewViewProvider(
      VIEW_TYPE,
      { resolveWebviewView: adopt },
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.window.onDidChangeVisibleTextEditors(sync),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('readloudly.highlightColor')) {
        decoration.dispose();
        decoration = makeDecoration();
      }
      if (e.affectsConfiguration('readloudly.speed') || e.affectsConfiguration('readloudly.voice'))
        restartIfPlaying();
      else if (e.affectsConfiguration('readloudly')) sync();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length && e.document.uri.toString() === lensLine?.uri) {
        lensLine = undefined;
        lensChanged.fire();
      }
      const s = queue.current;
      if (!s || queue.status === 'idle' || resumeAt !== undefined || !e.contentChanges.length)
        return;
      if (e.document.uri.toString() !== source.uri?.toString()) return;
      // Ranges are stale after an edit: pause, and resume later from the same sentence start.
      resumeAt = e.contentChanges.reduce(
        (at, c) =>
          c.rangeOffset < at ? Math.max(c.rangeOffset, at + c.text.length - c.rangeLength) : at,
        s.start
      );
      queue.pause();
      speak();
    })
  );

  return {
    highlighted: () => highlighted,
    word: () => word,
    status: () => queue.status,
    boots: () => boots,
    clickLine: (uri: vscode.Uri, line: number) => {
      lensLine = { uri: uri.toString(), line };
      lensChanged.fire();
    },
  };
}

// Hovering the status bar item shows a mini player, so the full view can stay closed.
function controls(playing: boolean) {
  const md = new vscode.MarkdownString(
    [
      '[$(debug-step-back)](command:readloudly.previous "Previous sentence")',
      `[$(${playing ? 'debug-pause' : 'play'})](command:readloudly.togglePause "${playing ? 'Pause' : 'Play'}")`,
      '[$(debug-step-over)](command:readloudly.next "Next sentence")',
      '[$(debug-stop)](command:readloudly.stop "Stop")',
      '[$(unmute) Player](command:readloudly.showPlayer "Show the player")',
    ].join('&nbsp;&nbsp;'),
    true
  );
  md.isTrusted = {
    enabledCommands: ['previous', 'togglePause', 'next', 'stop', 'showPlayer'].map(
      (c) => `readloudly.${c}`
    ),
  };
  return md;
}

export function deactivate() {}
