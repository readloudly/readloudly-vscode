import * as vscode from 'vscode';
import { ApiError, createClient, describe, type Request } from './api/client.ts';
import { Clips, estimateCredits, listVoices, type ProVoice } from './api/voices.ts';
import { Account } from './auth/session.ts';
import { Queue } from './player/queue.ts';
import { renderPlayer, VIEW_TYPE, type FromWebview, type Voice } from './player/panel.ts';
import { kokoroVoices } from './player/voices.ts';
import { disclosed, isBlocked } from './privacy.ts';
import { maskMarkdown, maskPlain } from './text/mask.ts';
import { capLength, splitSentences, wordAt, type Sentence } from './text/sentences.ts';
import type { ToWebview } from './webview/player.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
// The backend rejects longer texts, and shorter clips start sooner.
const MAX_CHARS = 1000;
const PRO_VOICE = 'readloudly.proVoice';

interface Source {
  uri?: vscode.Uri;
}

export function activate(context: vscode.ExtensionContext) {
  const queue = new Queue<Sentence>();
  const cfg = () => vscode.workspace.getConfiguration('readloudly');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  let source: Source = {};
  let resumeAt: number | undefined;
  let voices: Voice[] = [];
  let view: vscode.WebviewView | undefined;
  let highlighted: vscode.Range[] = [];
  let boots = 0;
  let decoration = makeDecoration();
  let word: vscode.Range[] = [];
  let lensLine: { uri: string; line: number; selected: boolean } | undefined;
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
  const voiceName = () => cfg().get<string>('voice', '');
  const isPro = () => voiceName().startsWith('rl:');
  const apiUrl = () =>
    cfg().get<string>('apiUrl', 'https://api.readloudly.com').replace(/\/+$/, '');
  const webUrl = () =>
    cfg().get<string>('webUrl', 'https://app.readloudly.com').replace(/\/+$/, '');
  const account = new Account(context.secrets, apiUrl);
  const api: Request = (path, init) => createClient(apiUrl(), account)(path, init);
  let proVoices: ProVoice[] = [];
  let credits: number | undefined;
  // Asked once per read: blocked file, signed out or a declined notice drops that read to the device voice.
  let proGate: Promise<boolean> | undefined;
  let proDenied = false;

  async function clip(text: string, signal?: AbortSignal) {
    const body = JSON.stringify({ Text: text, VoiceId: voiceName().slice('rl:'.length) });
    const once = () => api('/voices', { method: 'POST', body, signal });
    // A busy self-hosted voice server is usually free again a moment later.
    const res = await once().catch((e: unknown) => {
      if (e instanceof ApiError && e.code === 'KOKORO_BUSY') return once();
      throw e;
    });
    return res.arrayBuffer();
  }
  const clips = new Clips(clip);

  async function refreshCredits() {
    const usage = (await (await api('/usage')).json()) as { totalActivePoints?: number };
    credits = usage.totalActivePoints;
    sync();
  }

  async function allowPro(doc: vscode.TextDocument | undefined, texts: string[]) {
    if (isBlocked(doc)) {
      void vscode.window.showWarningMessage(
        'ReadLoudly: this file matches readloudly.neverSendGlobs, so it is never sent to ReadLoudly.'
      );
      return false;
    }
    if (!(await account.get())) {
      void vscode.window
        .showInformationMessage('ReadLoudly: sign in to use ReadLoudly voices.', 'Sign In')
        .then((pick) => pick && account.signIn());
      return false;
    }
    if (!(await disclosed(context.globalState))) return false;
    const premium = context.globalState.get<{ premium?: boolean }>(PRO_VOICE)?.premium ?? true;
    vscode.window.setStatusBarMessage(
      `ReadLoudly: up to ${estimateCredits(texts, premium).toLocaleString()} credits, cached audio is free`,
      8000
    );
    // The balance is only a hint in the tooltip; a failed read keeps the last one shown.
    refreshCredits().catch(() => undefined);
    return true;
  }

  async function speakPro(token: number) {
    const items = queue.items.map((s) => s.text);
    const index = queue.index;
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === source.uri?.toString()
    );
    try {
      if (!(await (proGate ??= allowPro(doc, items)))) {
        proDenied = true;
        if (token === queue.token) speak();
        return;
      }
      const audio = await clips.get(items, index);
      if (token === queue.token && queue.status === 'playing')
        post({ type: 'play', token, audio, rate: speed(), chars: items[index]!.length });
    } catch (e) {
      if (token !== queue.token || (e instanceof Error && e.name === 'AbortError')) return;
      const { action, message } = describe(e);
      if (action === 'device' || action === 'retry') {
        proDenied = true;
        void vscode.window.showWarningMessage(`ReadLoudly: ${message}`);
        return speak();
      }
      queue.pause();
      sync();
      const fix = { credits: 'Get Credits', standard: 'Choose Voice', signIn: 'Sign In' }[action];
      const pick = await vscode.window.showWarningMessage(
        `ReadLoudly: ${message}`,
        fix,
        'Use Device Voice'
      );
      if (pick === 'Get Credits')
        void vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/pricing/`));
      else if (pick === 'Choose Voice') void chooseVoice();
      else if (pick === 'Sign In') void account.signIn();
      else if (pick === 'Use Device Voice' && queue.status === 'paused') {
        proDenied = true;
        queue.resume();
        speak();
      }
    }
  }
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
    status.tooltip = controls(queue.status === 'playing', credits);
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
    if (isPro() && !proDenied) return void speakPro(queue.token);
    post({
      type: 'speak',
      token: queue.token,
      text: s.text,
      rate: speed(),
      voice: isPro() ? '' : voiceName(),
    });
  }

  function sentencesOf(doc: vscode.TextDocument, from: number, to: number) {
    const text = doc.getText();
    const prose =
      doc.languageId === 'markdown'
        ? maskMarkdown(text, cfg().get('skipCodeBlocks', true))
        : maskPlain(text);
    return capLength(splitSentences(prose.slice(from, to), from), MAX_CHARS);
  }
  const sentencesOfText = (text: string) => capLength(splitSentences(maskPlain(text)), MAX_CHARS);

  function read(items: Sentence[], index: number, from: Source) {
    if (!items.length)
      return void vscode.window.showInformationMessage(
        'ReadLoudly: there is nothing to read here.'
      );
    source = from;
    resumeAt = undefined;
    clips.cancel();
    proGate = undefined;
    proDenied = false;
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
    read(all, index, { uri: doc.uri });
  }

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
        lensChanged.fire();
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
      } else if (m.type === 'cmd') void vscode.commands.executeCommand('readloudly.togglePause');
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
    const signedIn = !!(await account.get());
    if (signedIn && !proVoices.length)
      proVoices = await listVoices(api).catch((e: unknown) => {
        void vscode.window.showWarningMessage(
          `ReadLoudly: could not load ReadLoudly voices (${describe(e).message})`
        );
        return [];
      });
    const lang = vscode.env.language.split('-')[0]!;
    const mine = (v: { lang: string }) => Number(v.lang.startsWith(lang));
    const byLang = <T extends { lang: string }>(list: T[]) =>
      [...list].sort((a, b) => mine(b) - mine(a) || a.lang.localeCompare(b.lang));
    type Item = vscode.QuickPickItem & { name?: string; premium?: boolean; signIn?: true };
    const separator = (label: string): Item => ({
      label,
      kind: vscode.QuickPickItemKind.Separator,
    });
    const items: Item[] = [
      separator('Device voices, free and offline'),
      { label: 'System default', name: '' },
      ...byLang(voices).map((v) => ({
        label: v.label ?? v.name,
        description: v.lang,
        name: v.name,
      })),
      separator('ReadLoudly voices, sends the text to ReadLoudly'),
      ...(signedIn
        ? byLang(proVoices).flatMap((v, i, all) => [
            ...(all[i - 1]?.lang === v.lang ? [] : [separator(v.lang)]),
            {
              label: v.label,
              description: v.premium ? 'Premium, 1 credit per character' : 'Standard',
              name: v.name,
              premium: v.premium,
            },
          ])
        : [{ label: '$(account) Sign in for ReadLoudly voices', signIn: true as const }]),
    ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Choose a voice',
      matchOnDescription: true,
    });
    if (pick?.signIn) return void ((await account.signIn()) && chooseVoice());
    if (pick?.name === undefined) return;
    if (pick.name.startsWith('rl:'))
      await context.globalState.update(PRO_VOICE, { label: pick.label, premium: pick.premium });
    await cfg().update('voice', pick.name, vscode.ConfigurationTarget.Global);
  }

  const voiceLabel = () => {
    const name = voiceName();
    if (name.startsWith('rl:'))
      return context.globalState.get<{ label?: string }>(PRO_VOICE)?.label ?? 'ReadLoudly voice';
    // Kokoro names are known before the engine lists device voices, so the lens never shows a raw id.
    const voice = [...kokoroVoices(), ...voices].find((v) => v.name === name);
    return voice?.label ?? (name || 'System voice');
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
          // En spaces give each control room and a wider click target; the zero-width spaces stop VS Code trimming them.
          title: `\u200b\u2002${title.replace(' ', '\u2002')}\u2002\u200b`,
          tooltip,
          command: `readloudly.${command}`,
          arguments: args,
        });
      const live = queue.status === 'playing' || queue.status === 'paused';
      // Material Symbols glyphs from media/icons.woff, registered in package.json under contributes.icons.
      return [
        ...(live
          ? [
              queue.status === 'playing'
                ? lens('$(readloudly-pause) Pause', 'togglePause', 'Pause')
                : lens('$(readloudly-play) Resume', 'togglePause', 'Resume'),
              lens('$(readloudly-previous) Back', 'previous', 'Previous sentence'),
              lens('$(readloudly-next) Next', 'next', 'Next sentence'),
              lens('$(readloudly-stop) Stop', 'stop', 'Stop reading'),
            ]
          : lensLine.selected
            ? [
                lens(
                  '$(readloudly-play) Listen to selection',
                  'readSelection',
                  'Read the selected text aloud'
                ),
              ]
            : [
                lens('$(readloudly-play) Listen', 'readFromLine', 'Read aloud from this line', [
                  doc.uri,
                  line,
                ]),
              ]),
        lens(`$(readloudly-speed) Speed ${speed()}×`, 'cycleSpeed', 'Change speed'),
        lens(
          `$(readloudly-voice) Voice: ${voiceLabel().replace(/ \(.*\)$/, '')}`,
          'chooseVoice',
          'Choose voice'
        ),
      ];
    },
  };

  async function exportMp3() {
    const editor = editorOrWarn();
    if (!editor) return;
    if (!isPro()) {
      const pick = await vscode.window.showInformationMessage(
        'ReadLoudly: MP3 export uses a ReadLoudly voice. Choose one first.',
        'Choose Voice'
      );
      return void (pick && chooseVoice());
    }
    const { document: doc, selection } = editor;
    const texts = (
      selection.isEmpty
        ? sentencesOf(doc, 0, doc.getText().length)
        : sentencesOf(doc, doc.offsetAt(selection.start), doc.offsetAt(selection.end))
    ).map((s) => s.text);
    if (!texts.length)
      return void vscode.window.showInformationMessage('ReadLoudly: there is nothing to export.');
    if (!(await allowPro(doc, texts))) return;
    const target = await vscode.window.showSaveDialog({
      defaultUri:
        doc.uri.scheme === 'file'
          ? doc.uri.with({ path: doc.uri.path.replace(/(\.[^./]*)?$/, '.mp3') })
          : undefined,
      filters: { MP3: ['mp3'] },
    });
    if (!target) return;
    try {
      const saved = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ReadLoudly: exporting MP3',
          cancellable: true,
        },
        async (progress, cancel) => {
          const abort = new AbortController();
          cancel.onCancellationRequested(() => abort.abort());
          const parts: Uint8Array[] = [];
          // MP3 frames are self-contained, so one clip per sentence, back to back, is one playable file.
          for (const [i, text] of texts.entries()) {
            progress.report({
              message: `${i + 1} of ${texts.length}`,
              increment: 100 / texts.length,
            });
            parts.push(new Uint8Array(await clip(text, abort.signal)));
          }
          await vscode.workspace.fs.writeFile(target, Buffer.concat(parts));
          return true;
        }
      );
      refreshCredits().catch(() => undefined);
      const pick = await vscode.window.showInformationMessage(
        `ReadLoudly: saved ${target.path.split('/').pop()}.`,
        'Reveal'
      );
      if (saved && pick) void vscode.commands.executeCommand('revealFileInOS', target);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const { action, message } = describe(e);
      void vscode.window.showErrorMessage(
        `ReadLoudly: the MP3 was not saved. ${action === 'device' ? 'ReadLoudly could not be reached.' : message}`
      );
    }
  }

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
      });
    },
    readFile: () => {
      const editor = editorOrWarn();
      if (editor)
        read(sentencesOf(editor.document, 0, editor.document.getText().length), 0, {
          uri: editor.document.uri,
        });
    },
    readFromCursor: () => {
      const editor = editorOrWarn();
      if (editor) readDocFrom(editor.document, editor.document.offsetAt(editor.selection.active));
    },
    readClipboard: async () => read(sentencesOfText(await vscode.env.clipboard.readText()), 0, {}),
    // Chat, terminal, hovers and webviews never expose their selection, so copy it with VS Code's own command and read that.
    readFocused: async (copy = 'editor.action.clipboardCopyAction') => {
      // ponytail: text clipboards only; an image on the clipboard is replaced by the restored text.
      const saved = await vscode.env.clipboard.readText();
      await vscode.env.clipboard.writeText('');
      await vscode.commands.executeCommand(copy);
      const text = await vscode.env.clipboard.readText();
      await vscode.env.clipboard.writeText(saved);
      if (!text.trim())
        return void vscode.window.showInformationMessage(
          'ReadLoudly: select some text first, then press the shortcut again.'
        );
      read(sentencesOfText(text), 0, {});
    },
    togglePause,
    stop: () => {
      clips.cancel();
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
    signIn: () => account.signIn(),
    signOut: async () => {
      await account.signOut();
      void vscode.window.showInformationMessage('ReadLoudly: signed out.');
    },
    exportMp3,
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
    account,
    vscode.authentication.registerAuthenticationProvider('readloudly', 'ReadLoudly', account),
    account.onDidChangeSessions(() => {
      proVoices = [];
      credits = undefined;
      proGate = undefined;
      proDenied = false;
      sync();
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const sel = e.selections[0]!;
      const mouse = e.kind === vscode.TextEditorSelectionChangeKind.Mouse;
      // A click or a selection moves the player; a plain cursor move only retires a stale Read selection.
      if (!mouse && e.kind !== vscode.TextEditorSelectionChangeKind.Keyboard) return;
      if (!mouse && sel.isEmpty) {
        if (!lensLine?.selected) return;
        lensLine = { ...lensLine, selected: false };
      } else {
        const uri = e.textEditor.document.uri.toString();
        lensLine = { uri, line: sel.start.line, selected: !sel.isEmpty };
      }
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
      if (e.affectsConfiguration('readloudly.voice')) {
        clips.cancel();
        proGate = undefined;
        proDenied = false;
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
    clickLine: (uri: vscode.Uri, line: number, selected = false) => {
      lensLine = { uri: uri.toString(), line, selected };
      lensChanged.fire();
    },
    // Other extensions can read these exports, so the session hooks exist only under the test runner.
    ...(context.extensionMode === vscode.ExtensionMode.Test && {
      testSession: (s: { access: string; refresh?: string; email: string }) =>
        context.secrets.store('readloudly.session', JSON.stringify(s)),
      testDisclosed: () => context.globalState.update('readloudly.disclosed', true),
    }),
  };
}

// Hovering the status bar item shows a mini player, so the full view can stay closed.
function controls(playing: boolean, credits: number | undefined) {
  const md = new vscode.MarkdownString(
    [
      '[$(debug-step-back)](command:readloudly.previous "Previous sentence")',
      `[$(${playing ? 'debug-pause' : 'play'})](command:readloudly.togglePause "${playing ? 'Pause' : 'Play'}")`,
      '[$(debug-step-over)](command:readloudly.next "Next sentence")',
      '[$(debug-stop)](command:readloudly.stop "Stop")',
      '[$(unmute) Player](command:readloudly.showPlayer "Show the player")',
    ].join('&nbsp;&nbsp;') +
      (credits === undefined ? '' : `\n\n${credits.toLocaleString()} ReadLoudly credits left`),
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
