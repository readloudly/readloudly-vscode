import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goodVoices } from './voices.ts';

const v = (name: string) => ({ name, lang: 'en-US' });

test('hides novelty and robotic voices, in every language', () => {
  const names = goodVoices([
    v('Samantha'),
    v('Zarvox'),
    v('Bad News'),
    v('Rocko (English (US))'),
    v('Grandma (Deutsch (Deutschland))'),
    v('Microsoft Zira'),
  ]).map((x) => x.name);
  assert.deepEqual(names, ['Samantha', 'Microsoft Zira']);
});

test('keeps every voice when filtering would leave none', () => {
  const only = [v('Zarvox'), v('Fred')];
  assert.equal(goodVoices(only), only);
});
