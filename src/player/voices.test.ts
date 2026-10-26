import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goodVoices, kokoroVoices } from './voices.ts';

test('lists only the well graded Kokoro voices, marked as on-device', () => {
  const voices = kokoroVoices();
  assert.equal(voices.length, 10);
  assert.deepEqual(voices[0], {
    name: 'kokoro:af_heart',
    label: 'Heart (Kokoro)',
    lang: 'en-US',
    isDefault: false,
  });
  assert.ok(voices.some((v) => v.name === 'kokoro:bf_emma' && v.lang === 'en-GB'));
  assert.ok(!voices.some((v) => v.name === 'kokoro:am_adam'));
});

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
