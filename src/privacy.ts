import * as vscode from 'vscode';

const NOTICES = {
  pro: [
    'readloudly.disclosed',
    'ReadLoudly voices send the text you read to ReadLoudly to generate audio. Audio is cached by its text and voice, and is reused for anyone who reads the same text.',
  ],
  ai: [
    'readloudly.disclosedAi',
    "AI actions send the selection, or the whole file, to the language model you use in VS Code (for example GitHub Copilot), under that provider's terms.",
  ],
} as const;

// Files that may hold secrets never go to ReadLoudly, whatever voice is chosen.
export function isBlocked(doc: vscode.TextDocument | undefined): boolean {
  if (!doc) return false;
  const globs = vscode.workspace.getConfiguration('readloudly').get<string[]>('neverSendGlobs', []);
  return globs.some((pattern) => vscode.languages.match({ pattern }, doc) > 0);
}

// The one-time notice before any text leaves the machine; declining keeps the text where it is.
export async function disclosed(state: vscode.Memento, kind: keyof typeof NOTICES = 'pro') {
  const [key, message] = NOTICES[kind];
  if (state.get<boolean>(key)) return true;
  const ok = await vscode.window.showInformationMessage(message, { modal: true }, 'Continue');
  if (ok) await state.update(key, true);
  return !!ok;
}
