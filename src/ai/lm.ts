import type { CancellationToken, LanguageModelChat, LanguageModelChatMessage } from 'vscode';
import { prompt, type Kind } from './prompts.ts';

export const NO_MODEL = 'AI features need a VS Code language model (for example GitHub Copilot).';

// Only types come from vscode, so the streaming and error paths run under node:test with a fake model.
export async function ask(
  model: Pick<LanguageModelChat, 'sendRequest'> | undefined,
  user: (text: string) => LanguageModelChatMessage,
  kind: Kind,
  text: string,
  lang: string | undefined,
  token: CancellationToken,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!model) throw new Error(NO_MODEL);
  let out = '';
  try {
    const res = await model.sendRequest(
      [user(prompt(kind, text, lang))],
      {
        justification:
          'ReadLoudly sends the text you chose to this model, then reads the answer aloud.',
      },
      token
    );
    for await (const chunk of res.text) {
      if (token.isCancellationRequested) break;
      out += chunk;
      onChunk(chunk);
    }
  } catch (e) {
    if (token.isCancellationRequested) return out;
    throw new Error(friendly(e), { cause: e });
  }
  return out;
}

// LanguageModelError codes, matched by name because the class lives in the vscode runtime.
export function friendly(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code;
  if (code === 'NoPermissions')
    return 'ReadLoudly was not allowed to use the language model. Run the command again and choose Allow.';
  if (code === 'Blocked')
    return 'The language model is not available right now, often because its quota is used up. Try again later.';
  if (code === 'NotFound') return NO_MODEL;
  return e instanceof Error ? e.message : String(e);
}
