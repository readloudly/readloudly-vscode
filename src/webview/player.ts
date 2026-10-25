import type { FromWebview, Voice } from '../player/panel.ts';
import { goodVoices } from '../player/voices.ts';

export interface PlayerState {
  type: 'state';
  status: 'idle' | 'playing' | 'paused' | 'ended';
  index: number;
  total: number;
  speed: number;
  secondsLeft: number;
  file: string;
  sentence: string;
  voices: Voice[];
  voice: string;
}
export type ToWebview =
  | PlayerState
  | { type: 'speak'; token: number; text: string; rate: number; voice: string }
  | { type: 'cancel' };

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };
const api = acquireVsCodeApi();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const synth = window.speechSynthesis;
let current = -1;
let keepalive = 0;

const listVoices = (): Voice[] =>
  goodVoices(synth.getVoices()).map((v) => ({ name: v.name, lang: v.lang, isDefault: v.default }));
const sendVoices = () => api.postMessage({ type: 'voices', voices: listVoices() });

function cancel() {
  current = -1;
  clearInterval(keepalive);
  synth.cancel();
}

function speak(m: { token: number; text: string; rate: number; voice: string }) {
  cancel();
  current = m.token;
  const u = new SpeechSynthesisUtterance(m.text);
  u.rate = m.rate;
  // A voice missing on this device falls back to the system default instead of failing.
  const voice = synth.getVoices().find((v) => v.name === m.voice);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
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

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function render(s: PlayerState) {
  const empty = s.total === 0;
  const playing = s.status === 'playing';
  const toggle = $('toggle');
  toggle.toggleAttribute('data-paused', !playing);
  toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  for (const id of ['previous', 'next']) ($(id) as HTMLButtonElement).disabled = empty;
  $('speed-t').textContent = `${s.speed}×`;
  $('needle').style.transform =
    `rotate(${Math.max(-70, Math.min(70, ((s.speed - 0.5) / 2) * 140 - 70))}deg)`;
  $('time').textContent = empty ? '' : `${fmt(s.secondsLeft)} left`;
  $('track').style.transform = `scaleX(${empty ? 0 : (s.index + 1) / s.total})`;
  $('pos').textContent = empty ? 'Nothing to read yet' : `Sentence ${s.index + 1} of ${s.total}`;
  $('file').textContent = s.file;
  $('now').textContent = empty
    ? 'Select text in the editor, then run ReadLoudly: Read Selection.'
    : s.sentence;
  const select = $<HTMLSelectElement>('voice');
  select.replaceChildren(new Option('System default', ''));
  for (const v of s.voices) select.append(new Option(`${v.name} (${v.lang})`, v.name));
  select.value = s.voices.some((v) => v.name === s.voice) ? s.voice : '';
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  // VS Code relays extension messages from the webview host frame, which shares this frame's origin.
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (m.type === 'speak') speak(m);
  else if (m.type === 'cancel') cancel();
  else if (m.type === 'state') render(m);
});

const cmd = (c: Extract<FromWebview, { type: 'cmd' }>['cmd']) =>
  api.postMessage({ type: 'cmd', cmd: c });
for (const id of ['toggle', 'previous', 'next', 'stop'] as const)
  $(id).addEventListener('click', () => cmd(id));
$('speed').addEventListener('click', (e) => cmd(e.shiftKey ? 'slower' : 'faster'));
$<HTMLSelectElement>('voice').addEventListener('change', (e) =>
  api.postMessage({ type: 'voice', name: (e.target as HTMLSelectElement).value })
);
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  const map: Record<string, Parameters<typeof cmd>[0]> = {
    ' ': 'toggle',
    ArrowLeft: 'previous',
    ArrowRight: 'next',
    Escape: 'stop',
  };
  const c = map[e.key];
  if (!c || (e.key === ' ' && e.target instanceof HTMLButtonElement)) return;
  e.preventDefault();
  cmd(c);
});

synth.addEventListener('voiceschanged', sendVoices);
api.postMessage({ type: 'boot' });
sendVoices();
