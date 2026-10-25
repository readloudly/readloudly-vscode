export type Kind = 'summarize' | 'translate' | 'explain' | 'simplify';

export const LANGUAGES = [
  ['English', 'en'],
  ['Spanish', 'es'],
  ['French', 'fr'],
  ['German', 'de'],
  ['Portuguese', 'pt'],
  ['Italian', 'it'],
  ['Dutch', 'nl'],
  ['Polish', 'pl'],
  ['Russian', 'ru'],
  ['Turkish', 'tr'],
  ['Arabic', 'ar'],
  ['Hindi', 'hi'],
  ['Bengali', 'bn'],
  ['Urdu', 'ur'],
  ['Indonesian', 'id'],
  ['Vietnamese', 'vi'],
  ['Chinese', 'zh'],
  ['Japanese', 'ja'],
  ['Korean', 'ko'],
] as const;

export type Language = { name: string; code: string };

// Accepts a name or a code at the start of a chat message, for example "/translate Spanish Hello".
export function leadingLanguage(message: string): { lang: Language; rest: string } | undefined {
  const [first = '', ...rest] = message
    .trim()
    .replace(/^to\s+/i, '')
    .split(/\s+/);
  const word = first.replace(/[:,]$/, '').toLowerCase();
  const hit = LANGUAGES.find(([name, code]) => name.toLowerCase() === word || code === word);
  return hit && { lang: { name: hit[0], code: hit[1] }, rest: rest.join(' ') };
}

const KEEP =
  'Keep the Markdown structure. Leave code blocks, inline code, identifiers, URLs and file names exactly as they are.';

const ASK: Record<Kind, (lang?: string) => string> = {
  summarize: () =>
    'Summarize the text below for someone who will listen to it read aloud. Write a short paragraph and at most five bullet points in plain sentences, under 150 words.',
  translate: (lang) => `Translate the text below into ${lang ?? 'English'}. ${KEEP}`,
  explain: () =>
    'Explain the text below in plain words for someone who will listen to it. If it is code, say what it does step by step instead of reading symbols out. Use short sentences in Markdown.',
  simplify: () =>
    `Rewrite the text below at about a 6th-grade reading level, keeping every important fact. ${KEEP}`,
};

export const prompt = (kind: Kind, text: string, lang?: string) =>
  `${ASK[kind](lang)} Reply with the result only.\n\n<text>\n${text}\n</text>`;
