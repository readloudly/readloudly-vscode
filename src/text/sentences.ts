export interface Sentence {
  text: string;
  start: number;
  end: number;
}

// A fixed locale keeps segmentation the same on every machine.
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

export function splitSentences(prose: string, base = 0): Sentence[] {
  const out: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(prose)) {
    const text = segment.trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const start = base + index + segment.length - segment.trimStart().length;
    const spoken = text.replace(/\s+/g, ' ').replace(/ (?=[.,!?;:)])/g, '');
    out.push({ text: spoken, start, end: start + text.length });
  }
  return out;
}
