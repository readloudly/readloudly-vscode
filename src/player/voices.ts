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

// Chromium names them "Rocko (English (US))", so compare the part before the bracket; if only bad voices exist, keep them all.
export const goodVoices = <T extends { name: string }>(voices: T[]): T[] => {
  const good = voices.filter((v) => !BAD.has(v.name.split(' (')[0]!.trim().toLowerCase()));
  return good.length ? good : voices;
};
