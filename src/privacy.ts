import * as vscode from 'vscode';

const DISCLOSED = 'readloudly.disclosed';

// Files that may hold secrets never go to ReadLoudly, whatever voice is chosen.
export function isBlocked(doc: vscode.TextDocument | undefined): boolean {
  if (!doc) return false;
  const globs = vscode.workspace.getConfiguration('readloudly').get<string[]>('neverSendGlobs', []);
  return globs.some((pattern) => vscode.languages.match({ pattern }, doc) > 0);
}

// The one-time notice before any text leaves the machine; declining keeps the device voice.
export async function disclosed(state: vscode.Memento): Promise<boolean> {
  if (state.get<boolean>(DISCLOSED)) return true;
  const ok = await vscode.window.showInformationMessage(
    'ReadLoudly voices and AI send the text you read to ReadLoudly to generate audio. Generated audio is cached by content and can be reused for anyone who reads the same text.',
    { modal: true },
    'Continue'
  );
  if (ok) await state.update(DISCLOSED, true);
  return !!ok;
}
