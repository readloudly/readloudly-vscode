// Apple novelty and robotic Eloquence voices; the same list as the web frontend's voiceQuality.ts and readloudly-native.
const BAD = new Set([
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'good news',
  'jester',
  'organ',
  'pipe organ',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
  'ralph',
  'hysterical',
  'kathy',
  'princess',
  'deranged',
  'albert',
  'fred',
  'junior',
  'eddy',
  'flo',
  'grandma',
  'grandpa',
  'reed',
  'rocko',
  'sandy',
  'shelley',
]);

// Kokoro voices graded C+ or better in kokoro-js's own VOICES table; they run on this computer (src/webview/kokoro.ts).
const KOKORO = {
  af_heart: 'Heart',
  af_bella: 'Bella',
  af_nicole: 'Nicole',
  af_aoede: 'Aoede',
  af_kore: 'Kore',
  af_sarah: 'Sarah',
  am_fenrir: 'Fenrir',
  am_michael: 'Michael',
  am_puck: 'Puck',
  bf_emma: 'Emma',
};

export const kokoroVoices = () =>
  Object.entries(KOKORO).map(([id, name]) => ({
    name: `kokoro:${id}`,
    label: `${name} (Kokoro)`,
    lang: id.startsWith('b') ? 'en-GB' : 'en-US',
    isDefault: false,
  }));

// Chromium names them "Rocko (English (US))", so compare the part before the bracket; if only bad voices exist, keep them all.
export const goodVoices = <T extends { name: string }>(voices: T[]): T[] => {
  const good = voices.filter((v) => !BAD.has(v.name.split(' (')[0]!.trim().toLowerCase()));
  return good.length ? good : voices;
};
