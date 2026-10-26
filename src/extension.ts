import * as vscode from 'vscode';
import { ApiError, createClient, describe, type Request } from './api/client.ts';
import { Clips, estimateCredits, listVoices, type ProVoice } from './api/voices.ts';
import { ask, NO_MODEL } from './ai/lm.ts';
import { LANGUAGES, leadingLanguage, type Kind, type Language } from './ai/prompts.ts';
import { Account } from './auth/session.ts';
import { Queue } from './player/queue.ts';
import { renderPlayer, VIEW_TYPE, type FromWebview, type Voice } from './player/panel.ts';
import { kokoroVoices } from './player/voices.ts';
import { disclosed, isBlocked } from './privacy.ts';
import { maskMarkdown, maskPlain } from './text/mask.ts';
import { capLength, splitSentences, wordAt, type Sentence } from './text/sentences.ts';
import type { ToWebview } from './webview/player.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const WORDS_PER_SECOND = 2.6;
// The backend rejects longer texts, and shorter clips start sooner.
const MAX_CHARS = 1000;
const PRO_VOICE = 'readloudly.proVoice';

interface Source {
  uri?: vscode.Uri;
  // A one-off voice for this read, such as a device voice in the language of a translation.
  voice?: string;
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

  // Integration tests read what the engine was asked to play; nothing is kept outside the test runner.
  const sent: ToWebview[] | undefined =
    context.extensionMode === vscode.ExtensionMode.Test ? [] : undefined;
  const post = (message: ToWebview) => {
    sent?.push(message);
    void view?.webview.postMessage(message);
  };
  const speed = () => cfg().get<number>('speed', 1);
  const voiceName = () => cfg().get<string>('voice', '');
  const readingVoice = () => source.voice ?? voiceName();
  const isPro = (name = readingVoice()) => name.startsWith('rl:');
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

  async function clip(text: string, signal?: AbortSignal, voice = readingVoice()) {
    const body = JSON.stringify({ Text: text, VoiceId: voice.slice('rl:'.length) });
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

  // Secret-looking files never leave the machine: not to ReadLoudly, a language model or a URL.
  const blocked = (doc: vscode.TextDocument | undefined) => {
    if (!isBlocked(doc)) return false;
    void vscode.window.showWarningMessage(
      'ReadLoudly: this file matches readloudly.neverSendGlobs, so its text is never sent anywhere.'
    );
    return true;
  };

  async function allowPro(doc: vscode.TextDocument | undefined, texts: string[]) {
    if (blocked(doc)) return false;
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
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === source.uri?.toString()
    );
    try {
      if (!(await (proGate ??= allowPro(doc, items)))) {
        proDenied = true;
        if (token === queue.token) speak();
        return;
      }
      // Next pressed while the notice was open: only the sentence the reader is on now is fetched.
      if (token !== queue.token) return;
      const index = queue.index;
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
      const fix = { credits: 'Get Credits', standard: 'Use a Standard Voice', signIn: 'Sign In' }[
        action
      ];
      const pick = await vscode.window.showWarningMessage(
        `ReadLoudly: ${message}`,
        fix,
        'Use Device Voice'
      );
      if (pick === 'Get Credits')
        void vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/pricing/`));
      else if (pick === 'Use a Standard Voice') void chooseVoice();
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
    status.accessibilityInformation = {
      label:
        queue.status === 'idle'
          ? 'ReadLoudly, not reading'
          : `ReadLoudly, ${queue.status}, sentence ${queue.index + 1} of ${n}`,
    };
    const words = queue.items
      .slice(queue.index)
      .reduce((sum, x) => sum + x.text.split(' ').length, 0);
    const voice = voiceName();
    post({
      type: 'state',
      status: queue.status,
      index: queue.index,
      total: n,
      speed: speed(),
      secondsLeft: words / WORDS_PER_SECOND / speed(),
      file: source.uri?.path.split('/').pop() ?? '',
      sentence: s?.text ?? '',
      voices: isPro(voice)
        ? [{ name: voice, lang: 'ReadLoudly', isDefault: false, label: voiceLabel() }, ...voices]
        : voices,
      voice,
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
    if (isPro() && !proDenied) return void speakPro(queue.token);
    post({
      type: 'speak',
      token: queue.token,
      text: s.text,
      rate: speed(),
      voice: isPro() ? '' : readingVoice(),
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
  const sentencesOfText = (text: string, markdown = false) =>
    capLength(splitSentences(markdown ? maskMarkdown(text, true) : maskPlain(text)), MAX_CHARS);

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
    renderPlayer(v.webview, context.extensionUri, context.globalStorageUri);
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
        void vscode.window
          .showWarningMessage(
            `ReadLoudly: the voice stopped (${m.error}). Press play to try again.`,
            'Choose Voice'
          )
          .then((pick) => pick && chooseVoice());
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
    type Item = vscode.QuickPickItem & {
      name?: string;
      premium?: boolean;
      lang?: string;
      signIn?: true;
    };
    const separator = (label: string): Item => ({
      label,
      kind: vscode.QuickPickItemKind.Separator,
    });
    const items: Item[] = [
      separator('Device voices, free, text stays on this computer'),
      { label: 'System default', name: '' },
      ...byLang(voices).map((v) => ({
        label: v.label ?? v.name,
        description: v.name.startsWith('kokoro:')
          ? `${v.lang}, downloads a voice model once`
          : v.lang,
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
              lang: v.lang,
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
      await context.globalState.update(PRO_VOICE, {
        label: pick.label,
        premium: pick.premium,
        lang: pick.lang,
      });
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

  // A translation is read by a voice in its language when the chosen one does not speak it.
  function voiceFor(code: string) {
    const name = voiceName();
    const lang = name.startsWith('rl:')
      ? context.globalState.get<{ lang?: string }>(PRO_VOICE)?.lang
      : [...kokoroVoices(), ...voices].find((v) => v.name === name)?.lang;
    const speaks = (l?: string) => !!l && l.toLowerCase().startsWith(code);
    if (speaks(lang)) return undefined;
    const match = voices.find((v) => speaks(v.lang))?.name;
    if (!match)
      void vscode.window.showInformationMessage(
        `ReadLoudly: no voice for this language is installed, so your current voice reads it. Add one in your system's speech settings.`
      );
    return match;
  }

  const aiText = new Map<string, string>();
  const aiChanged = new vscode.EventEmitter<vscode.Uri>();
  let aiCount = 0;
  const chatModel = async () =>
    (await vscode.lm.selectChatModels({ vendor: 'copilot' }))[0] ??
    (await vscode.lm.selectChatModels())[0];
  const TITLES: Record<Kind, string> = {
    summarize: 'Summary',
    translate: 'Translation',
    explain: 'Explanation',
    simplify: 'Simpler version',
  };

  async function pickLanguage(): Promise<Language | undefined> {
    const pick = await vscode.window.showQuickPick(
      LANGUAGES.map(([name, code]) => ({ label: name, description: code, code })),
      { placeHolder: 'Translate into' }
    );
    return pick && { name: pick.label, code: pick.code };
  }

  // The answer streams into a read-only Markdown document beside the text, then is read aloud with the usual highlight.
  async function aiAndListen(kind: Kind) {
    const editor = editorOrWarn();
    if (!editor) return;
    const { document: doc, selection } = editor;
    if (blocked(doc)) return;
    const text = selection.isEmpty ? doc.getText() : doc.getText(selection);
    if (!text.trim())
      return void vscode.window.showInformationMessage('ReadLoudly: there is nothing to send.');
    const lang = kind === 'translate' ? await pickLanguage() : undefined;
    if (kind === 'translate' && !lang) return;
    const model = await chatModel();
    if (!model) return void vscode.window.showWarningMessage(`ReadLoudly: ${NO_MODEL}`);
    if (!(await disclosed(context.globalState, 'ai'))) return;
    const title = lang ? `${TITLES[kind]} (${lang.name})` : TITLES[kind];
    const uri = vscode.Uri.from({ scheme: 'readloudly-ai', path: `/${title} ${++aiCount}.md` });
    const key = uri.toString();
    aiText.set(key, '');
    await vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });
    let cancelled = false;
    let shown = 0;
    try {
      const out = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `ReadLoudly: writing the ${title.toLowerCase()}`,
          cancellable: true,
        },
        (_, token) => {
          token.onCancellationRequested(() => (cancelled = true));
          return ask(
            model,
            vscode.LanguageModelChatMessage.User,
            kind,
            text,
            lang?.name,
            token,
            (chunk) => {
              aiText.set(key, aiText.get(key) + chunk);
              if (Date.now() - shown < 150) return;
              shown = Date.now();
              aiChanged.fire(uri);
            }
          );
        }
      );
      aiText.set(key, out);
      aiChanged.fire(uri);
      if (cancelled || !out.trim()) return;
      const result = await vscode.workspace.openTextDocument(uri);
      for (let i = 0; i < 20 && result.getText() !== out; i++)
        await new Promise((r) => setTimeout(r, 50));
      read(sentencesOf(result, 0, out.length), 0, { uri, voice: lang && voiceFor(lang.code) });
    } catch (e) {
      void vscode.window.showWarningMessage(`ReadLoudly: ${e instanceof Error ? e.message : e}`);
    }
  }

  const chatHandler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
    const editor = vscode.window.activeTextEditor;
    const selected =
      editor && !editor.selection.isEmpty && !isBlocked(editor.document)
        ? editor.document.getText(editor.selection)
        : '';
    const kind = request.command as Kind | 'read' | undefined;
    if (!kind) {
      stream.markdown(
        'Use `/summarize`, `/translate Spanish`, `/explain`, `/simplify` or `/read`, followed by the text. With no text, the editor selection is used.'
      );
      return;
    }
    const lead = kind === 'translate' ? leadingLanguage(request.prompt) : undefined;
    if (kind === 'translate' && !lead) {
      stream.markdown('Start with the language, for example `/translate Spanish`, then the text.');
      return;
    }
    const text = (lead ? lead.rest : request.prompt).trim() || selected;
    if (!text) {
      stream.markdown('Type the text after the command, or select it in the editor first.');
      return;
    }
    if (kind === 'read') {
      read(sentencesOfText(text, true), 0, {});
      stream.markdown('Reading it aloud now.');
      stream.button({ command: 'readloudly.stop', title: 'Stop' });
      return;
    }
    try {
      const out = await ask(
        request.model,
        vscode.LanguageModelChatMessage.User,
        kind,
        text,
        lead?.lang.name,
        token,
        (c) => stream.markdown(c)
      );
      if (out.trim())
        stream.button({
          command: 'readloudly.listenText',
          title: 'Listen',
          arguments: [out, lead?.lang.code],
        });
    } catch (e) {
      stream.markdown(e instanceof Error ? e.message : String(e));
    }
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
    if (!isPro(voiceName())) {
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
    const chars = texts.reduce((n, t) => n + t.length, 0);
    // The same 10,000-character limit as the web app's MP3 download.
    if (chars > 10000)
      return void vscode.window.showWarningMessage(
        `ReadLoudly: MP3 export takes up to 10,000 characters and this is ${chars.toLocaleString()}. Select a part of it.`
      );
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
            parts.push(new Uint8Array(await clip(text, abort.signal, voiceName())));
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

  // The same deep links as the Chrome extension; a local PDF cannot travel in a URL, so it is uploaded on the web.
  async function openInWeb(uri?: vscode.Uri) {
    const open = (path: string) => vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${path}`));
    if (uri?.path.toLowerCase().endsWith('.pdf')) {
      await open('/dashboard/');
      return void vscode.window.showInformationMessage(
        `ReadLoudly: upload ${uri.path.split('/').pop()} on the dashboard that just opened.`
      );
    }
    const editor = editorOrWarn();
    if (!editor) return;
    const { document: doc, selection } = editor;
    if (blocked(doc)) return;
    const text = (selection.isEmpty ? doc.getText() : doc.getText(selection)).trim();
    if (/^https?:\/\/\S+$/.test(text))
      return void open(`/dashboard/?url=${encodeURIComponent(text)}`);
    if (!text)
      return void vscode.window.showInformationMessage('ReadLoudly: there is nothing to open.');
    await open(`/viewer/tts/d/?text=${encodeURIComponent(text.slice(0, 2000))}`);
    if (text.length > 2000)
      void vscode.window.showInformationMessage(
        'ReadLoudly: the web reader got the first 2,000 characters. Upload the file there to read all of it.'
      );
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
      let text: string;
      try {
        await vscode.env.clipboard.writeText('');
        await vscode.commands.executeCommand(copy);
        text = await vscode.env.clipboard.readText();
      } finally {
        await vscode.env.clipboard.writeText(saved);
      }
      if (!text.trim())
        return void vscode.window.showInformationMessage(
          'ReadLoudly: select some text first, then press the shortcut again.'
        );
      read(sentencesOfText(text), 0, {});
      // Chat and terminal text has no CodeLens, so bring the Explorer player into view without taking focus.
      void showPlayer();
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
    openInWeb,
    summarizeAndListen: () => aiAndListen('summarize'),
    translateAndListen: () => aiAndListen('translate'),
    explainAndListen: () => aiAndListen('explain'),
    simplifyAndListen: () => aiAndListen('simplify'),
    listenText: (text: string, code?: string) =>
      read(sentencesOfText(text, true), 0, { voice: code && voiceFor(code) }),
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
    aiChanged,
    vscode.workspace.registerTextDocumentContentProvider('readloudly-ai', {
      onDidChange: aiChanged.event,
      provideTextDocumentContent: (uri) => aiText.get(uri.toString()) ?? '',
    }),
    Object.assign(vscode.chat.createChatParticipant('readloudly.reader', chatHandler), {
      iconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png'),
    }),
    // Read-only for the agent: the tool only speaks the text it is given.
    vscode.lm.registerTool<{ text: string }>('readloudly_read_aloud', {
      invoke: ({ input }) => {
        const items = sentencesOfText(input.text ?? '', true);
        // An agent can pass any file's text, so it is never sent to ReadLoudly: a Pro choice reads with the device voice.
        if (items.length) read(items, 0, { voice: isPro(voiceName()) ? '' : undefined });
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            items.length
              ? 'ReadLoudly is reading the text aloud to the user.'
              : 'There was no readable text.'
          ),
        ]);
      },
    }),
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
    playerVisible: () => view?.visible ?? false,
    clickLine: (uri: vscode.Uri, line: number, selected = false) => {
      lensLine = { uri: uri.toString(), line, selected };
      lensChanged.fire();
    },
    // Other extensions can read these exports, so the session hooks exist only under the test runner.
    ...(context.extensionMode === vscode.ExtensionMode.Test && {
      testSession: (s: { access: string; refresh?: string; email: string }) =>
        context.secrets.store('readloudly.session', JSON.stringify(s)),
      testDisclosed: async () => {
        await context.globalState.update('readloudly.disclosed', true);
        await context.globalState.update('readloudly.disclosedAi', true);
      },
      sent: () => sent ?? [],
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
