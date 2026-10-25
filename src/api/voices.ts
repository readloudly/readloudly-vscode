import type { Request } from './client.ts';

export interface ProVoice {
  name: string;
  label: string;
  lang: string;
  isDefault: false;
  premium: boolean;
}

interface Page {
  docs: { Id: string; Name: string; LanguageCode: string; IsPremium: boolean }[];
  totalPages: number;
}

// Premium voices cost a credit per character and standard voices a quarter, rounded up per request; cache hits are free, so this is an upper bound.
export const estimateCredits = (texts: string[], premium: boolean) =>
  texts.reduce((sum, t) => sum + (premium ? t.length : Math.ceil(t.length / 4)), 0);

export async function listVoices(request: Request): Promise<ProVoice[]> {
  const out: ProVoice[] = [];
  for (let pg = 1, pages = 1; pg <= pages; pg++) {
    const page = (await (await request(`/voices?limit=500&pg=${pg}`)).json()) as Page;
    pages = page.totalPages;
    for (const v of page.docs)
      out.push({
        name: `rl:${v.Id}`,
        label: v.Name,
        lang: v.LanguageCode,
        isDefault: false,
        premium: v.IsPremium,
      });
  }
  return out;
}

type Fetch = (text: string, signal: AbortSignal) => Promise<ArrayBuffer>;

// One clip per sentence, with the next two fetched while the current one plays; cancel() aborts them all.
export class Clips {
  private readonly fetchClip: Fetch;
  private pending = new Map<string, Promise<ArrayBuffer>>();
  private abort = new AbortController();

  constructor(fetchClip: Fetch) {
    this.fetchClip = fetchClip;
  }

  get(texts: string[], index: number): Promise<ArrayBuffer> {
    for (const i of [index, index + 1, index + 2]) {
      const text = texts[i];
      if (text === undefined || this.pending.has(text)) continue;
      const clip = this.fetchClip(text, this.abort.signal);
      // A prefetch that fails is retried when its turn comes, and never reports an unhandled rejection.
      clip.catch(() => this.pending.delete(text));
      this.pending.set(text, clip);
    }
    return this.pending.get(texts[index]!)!;
  }

  cancel() {
    this.abort.abort();
    this.abort = new AbortController();
    this.pending.clear();
  }
}
