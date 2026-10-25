import type { FromWebview, Voice } from '../player/panel.ts';
import { goodVoices, kokoroVoices } from '../player/voices.ts';

export type ToWebview =
  | { type: 'speak'; token: number; text: string; rate: number; voice: string }
  | { type: 'play'; token: number; audio: ArrayBuffer; rate: number; chars: number }
  | { type: 'cancel' };

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };
const api = acquireVsCodeApi();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const synth = window.speechSynthesis;
let current = -1;
let keepalive = 0;
let ctx: AudioContext | undefined;
let source: AudioBufferSourceNode | undefined;
let engine: Promise<typeof import('./kokoro.ts')> | undefined;
const media = document.body.dataset.media!;

// One media element for every Pro clip: a new element would be blocked again until another click.
const audio = new Audio();
let unlocked = false;

// A silent WAV played inside the click unlocks the media element, as resume() does for the AudioContext.
function silence() {
  const v = new DataView(new ArrayBuffer(46));
  const ascii = (at: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 38, true);
  ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, 2, true);
  return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
}

// Webview audio stays blocked until a click in this frame; one click unlocks both outputs for the session.
document.addEventListener(
  'click',
  () => {
    void (ctx ??= new AudioContext()).resume();
    if (unlocked) return;
    audio.src = silence();
    audio.play().then(
      () => (unlocked = true),
      () => undefined
    );
  },
  true
);

const listVoices = (): Voice[] => [
  ...kokoroVoices(),
  ...goodVoices(synth.getVoices()).map((v) => ({
    name: v.name,
    lang: v.lang,
    isDefault: v.default,
  })),
];
const sendVoices = () => api.postMessage({ type: 'voices', voices: listVoices() });

function cancel() {
  current = -1;
  clearInterval(keepalive);
  synth.cancel();
  source?.stop();
  source = undefined;
  audio.onended = audio.onerror = null;
  audio.pause();
}

// Pro clips are MP3 bytes from the extension host; the media element keeps the pitch when the speed changes.
function play(m: { token: number; audio: ArrayBuffer; rate: number; chars: number }) {
  cancel();
  current = m.token;
  const url = URL.createObjectURL(new Blob([m.audio], { type: 'audio/mpeg' }));
  const done = (error?: string) => {
    clearInterval(keepalive);
    URL.revokeObjectURL(url);
    if (m.token !== current) return;
    api.postMessage(
      error ? { type: 'error', token: m.token, error } : { type: 'ended', token: m.token }
    );
  };
  audio.src = url;
  audio.playbackRate = m.rate;
  audio.onended = () => done();
  audio.onerror = () => done('the audio could not be played');
  audio.play().catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'NotAllowedError') $('unlock').hidden = false;
    done('click Turn on sound in the ReadLoudly section of the Explorer, once');
  });
  // Clips carry no word timings either, so the spoken word is estimated as for Kokoro.
  keepalive = window.setInterval(() => {
    if (audio.duration)
      api.postMessage({
        type: 'word',
        token: m.token,
        charIndex: Math.floor((audio.currentTime / audio.duration) * m.chars),
      });
  }, 150);
}

async function speakKokoro(m: { token: number; text: string; rate: number; voice: string }) {
  const note = $('note');
  try {
    engine ??= import(`${media}/kokoro.js`);
    const { samples, rate } = await (
      await engine
    ).generate(
      m.text,
      m.voice.slice('kokoro:'.length),
      m.rate,
      `${media}/`,
      (t) => (note.textContent = t)
    );
    note.textContent = '';
    if (m.token !== current) return;
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') {
      $('unlock').hidden = false;
      throw new Error('click Turn on sound in the ReadLoudly section of the Explorer, once');
    }
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (m.token !== current) return;
      clearInterval(keepalive);
      api.postMessage({ type: 'ended', token: m.token });
    };
    source.start();
    // Kokoro gives no word timings, so the spoken word is estimated from the share of audio played.
    const t0 = ctx.currentTime;
    keepalive = window.setInterval(() => {
      const charIndex = Math.floor(((ctx!.currentTime - t0) / buffer.duration) * m.text.length);
      api.postMessage({ type: 'word', token: m.token, charIndex });
    }, 150);
  } catch (e) {
    note.textContent = '';
    if (m.token === current)
      api.postMessage({
        type: 'error',
        token: m.token,
        error: e instanceof Error ? e.message : String(e),
      });
  }
}

function speak(m: { token: number; text: string; rate: number; voice: string }) {
  cancel();
  current = m.token;
  if (m.voice.startsWith('kokoro:')) return void speakKokoro(m);
  const u = new SpeechSynthesisUtterance(m.text);
  u.rate = m.rate;
  // A voice missing on this device falls back to the system default instead of failing.
  const voice = synth.getVoices().find((v) => v.name === m.voice);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.onboundary = (e) => {
    if (e.name === 'word' && m.token === current)
      api.postMessage({ type: 'word', token: m.token, charIndex: e.charIndex });
  };
  u.onend = () => {
    if (m.token !== current) return;
    clearInterval(keepalive);
    api.postMessage({ type: 'ended', token: m.token });
  };
  u.onerror = (e) => {
    if (m.token !== current || e.error === 'interrupted' || e.error === 'canceled') return;
    clearInterval(keepalive);
    api.postMessage({ type: 'error', token: m.token, error: e.error });
  };
  synth.speak(u);
  // Chromium can leave a fresh utterance paused after cancel() with no error, so nudge it.
  synth.resume();
  keepalive = window.setInterval(() => synth.resume(), 5000);
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  // VS Code relays extension messages from the webview host frame, which shares this frame's origin.
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (m.type === 'speak') speak(m);
  else if (m.type === 'play') play(m);
  else if (m.type === 'cancel') cancel();
});

// The one click that unlocks audio also resumes the sentence that was waiting for it.
$('unlock').addEventListener('click', () => {
  $('unlock').hidden = true;
  api.postMessage({ type: 'cmd', cmd: 'toggle' });
});

synth.addEventListener('voiceschanged', sendVoices);
api.postMessage({ type: 'boot' });
sendVoices();
