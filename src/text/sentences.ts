export interface Sentence {
  text: string;
  start: number;
  end: number;
  // Source offset of each spoken character, so a word boundary from the engine lands on the editor text.
  map: number[];
}

// A fixed locale keeps segmentation the same on every machine.
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

export function splitSentences(prose: string, base = 0): Sentence[] {
  const out: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(prose)) {
    const raw = segment.trim();
    if (!/[\p{L}\p{N}]/u.test(raw)) continue;
    const start = base + index + segment.length - segment.trimStart().length;
    let text = '';
    const map: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!;
      if (/\s/.test(c)) {
        if (text.endsWith(' ')) continue;
      } else if (/[.,!?;:)]/.test(c) && text.endsWith(' ')) {
        text = text.slice(0, -1);
        map.pop();
      }
      text += /\s/.test(c) ? ' ' : c;
      map.push(start + i);
    }
    out.push({ text, start, end: start + raw.length, map });
  }
  return out;
}

// The source range of the spoken word that contains (or starts after) charIndex.
export function wordAt(s: Sentence, charIndex: number): [number, number] {
  let from = Math.min(Math.max(charIndex, 0), s.text.length - 1);
  while (from > 0 && s.text[from - 1] !== ' ') from--;
  let to = from;
  while (to < s.text.length && s.text[to] !== ' ') to++;
  return [s.map[from]!, s.map[to - 1]! + 1];
}

// Pro voices take at most one capped request per clip, so a long sentence becomes clause-sized pieces with their own ranges.
export function capLength(sentences: Sentence[], max: number): Sentence[] {
  return sentences.flatMap((s) => {
    const out: Sentence[] = [];
    let from = 0;
    while (s.text.length - from > max) {
      const window = s.text.slice(from, from + max + 1);
      const clause = Math.max(...[', ', '; ', ': '].map((p) => window.lastIndexOf(p)));
      const space = window.lastIndexOf(' ');
      const cut = clause > 0 ? clause + 1 : space > 0 ? space : max;
      out.push(piece(s, from, from + cut));
      from += cut;
      while (s.text[from] === ' ') from++;
    }
    out.push(from ? piece(s, from, s.text.length) : s);
    return out;
  });
}

function piece(s: Sentence, from: number, to: number): Sentence {
  const map = s.map.slice(from, to);
  return { text: s.text.slice(from, to), start: map[0]!, end: map[map.length - 1]! + 1, map };
}
