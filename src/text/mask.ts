// Masks swap syntax for spaces without changing length, so every offset still points at the source.
const blank = (s: string) => s.replace(/[^\n]/g, ' ');

function inline(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, blank)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (m, text: string) => ' ' + text + ' '.repeat(m.length - text.length - 1))
    .replace(/<[^>\n]*>/g, blank)
    .replace(/https?:\/\/\S+/g, blank)
    .replace(/`+/g, blank)
    .replace(/\*\*|__|~~|\*|(?<!\w)_|_(?!\w)/g, blank);
}

export function maskMarkdown(src: string, skipCode: boolean): string {
  const lines = src.split('\n');
  const hard: boolean[] = [];
  let fence = '';
  let front = lines[0]?.trim() === '---';
  const out = lines.map((line, i) => {
    hard[i] = true;
    if (front) {
      if (i > 0 && line.trim() === '---') front = false;
      return blank(line);
    }
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = '';
      return f || skipCode ? blank(line) : line;
    }
    if (f) {
      fence = f;
      return blank(line);
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) || /^[\s|:-]+$/.test(line)) return blank(line);
    if (/^\s*\|/.test(line)) return inline(line.replace(/\|/g, ' '));
    const head = /^\s{0,3}#{1,6}(\s|$)/.exec(line) ?? /^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);
    if (head) return blank(head[0]) + inline(line.slice(head[0].length).replace(/\s#+\s*$/, blank));
    hard[i] = false;
    const quote = /^\s*(>\s?)+/.exec(line)?.[0] ?? '';
    return blank(quote) + inline(line.slice(quote.length));
  });
  const soft = (i: number) => !hard[i] && out[i]!.trim() !== '';
  return out.map((l, i) => (i === out.length - 1 ? l : l + (soft(i) && soft(i + 1) ? ' ' : '\n'))).join('');
}

// ponytail: a lowercase start is the only "wrapped line" signal; good enough for prose, code lines stay separate.
export function maskPlain(src: string): string {
  return src.replace(/(\S[^\S\n]*)\n(?=[^\S\n]*\p{Ll})/gu, '$1 ');
}
