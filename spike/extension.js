// M0 spike: answers docs/engine-spike.md questions 1-4 and writes spike/results/<platform>.json.
const vscode = require("vscode");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SENTENCE = "ReadLoudly checks how fast this voice starts.";
const FLOAT_COMMANDS = [
  "workbench.action.moveEditorToNewWindow",
  "workbench.action.enableCompactAuxiliaryWindow",
  "workbench.action.enableWindowAlwaysOnTop",
];

// Text reaches every OS engine as one argv entry or an env var, never through a shell string.
function osEngine() {
  if (process.platform === "darwin") return { cmd: "say", args: [SENTENCE], env: {} };
  if (process.platform === "win32") {
    const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($env:RL_TEXT)";
    return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script], env: { RL_TEXT: SENTENCE } };
  }
  return { cmd: "spd-say", args: ["--wait", SENTENCE], env: {} };
}

function timeOsEngine() {
  const { cmd, args, env } = osEngine();
  return new Promise((resolve) => {
    const t0 = performance.now();
    let spawnMs = null;
    const child = execFile(cmd, args, { env: { ...process.env, ...env }, timeout: 20000 }, (err) => {
      resolve({ cmd, spawnMs, totalMs: Math.round(performance.now() - t0), error: err ? String(err.message || err) : null });
    });
    child.once("spawn", () => { spawnMs = Math.round(performance.now() - t0); });
  });
}

function timeHostPlayer(cmd, args) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    execFile(cmd, args, { timeout: 20000 }, (err) => resolve({ cmd, args: args.slice(0, 2), totalMs: Math.round(performance.now() - t0), error: err ? String(err.message || err) : null }));
  });
}

function html(webview, nonce, mode) {
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; media-src blob:;`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
body{margin:0;font:13px system-ui;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
.pill{display:flex;align-items:center;gap:8px;margin:8px;padding:8px 14px;border-radius:999px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border,#8884);width:fit-content;-webkit-app-region:drag;cursor:grab}
#log{white-space:pre-wrap;padding:8px;font:12px ui-monospace,monospace}
</style></head><body>
<div class="pill" id="pill">Drag this pill. Does the window move?</div>
<button id="click-mp3">Manual check: click to play the MP3 at 1.5x</button>
<pre id="log"></pre>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const log = (m) => { document.getElementById("log").textContent += m + "\\n"; };
api.postMessage({ type: "boot", mode: ${JSON.stringify(mode)} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeVoices() {
  if (!("speechSynthesis" in window)) return { available: false };
  let voices = speechSynthesis.getVoices();
  const t0 = performance.now();
  if (!voices.length) {
    await Promise.race([new Promise((r) => speechSynthesis.addEventListener("voiceschanged", r, { once: true })), wait(4000)]);
    voices = speechSynthesis.getVoices();
  }
  const out = { available: true, count: voices.length, waitedMs: Math.round(performance.now() - t0),
    sample: voices.slice(0, 8).map((v) => v.name + " (" + v.lang + (v.localService ? ", local" : ", remote") + ")") };
  if (!voices.length) return out;
  const u = new SpeechSynthesisUtterance(${JSON.stringify(SENTENCE)});
  const t1 = performance.now();
  out.utterance = await new Promise((resolve) => {
    const r = { boundaries: 0, startMs: null, endMs: null, error: null };
    u.onstart = () => { r.startMs = Math.round(performance.now() - t1); };
    u.onboundary = () => { r.boundaries++; };
    u.onend = () => { r.endMs = Math.round(performance.now() - t1); resolve(r); };
    u.onerror = (e) => { r.error = e.error; resolve(r); };
    speechSynthesis.speak(u);
    setTimeout(() => { r.error = r.error || "timeout"; resolve(r); }, 15000);
  });
  return out;
}

async function probeAudio(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  const run = (muted) => new Promise((resolve) => {
    const a = new Audio(url);
    a.muted = muted;
    a.playbackRate = 1.5;
    const r = { muted, rate: 1.5, preservesPitch: a.preservesPitch, duration: null, wallMs: null, error: null };
    let t0 = 0;
    a.onloadedmetadata = () => { r.duration = a.duration; };
    a.onplaying = () => { t0 = performance.now(); };
    a.onended = () => { r.wallMs = Math.round(performance.now() - t0); r.expectedMs = Math.round((a.duration / 1.5) * 1000); resolve(r); };
    a.onerror = () => { r.error = "media error " + (a.error && a.error.code); resolve(r); };
    a.play().catch((e) => { r.error = e.name; resolve(r); });
    setTimeout(() => { r.error = r.error || "timeout"; resolve(r); }, 20000);
  });
  const unmuted = await run(false);
  const out = unmuted.error === "NotAllowedError" ? { unmuted, muted: await run(true) } : { unmuted };
  out.autoplayPolicy = document.featurePolicy ? document.featurePolicy.allowsFeature("autoplay") : "n/a";
  out.userActivation = navigator.userActivation ? navigator.userActivation.hasBeenActive : "n/a";
  out.webAudio = await probeWebAudio(bytes);
  return out;
}

async function probeWebAudio(bytes) {
  const ctx = new AudioContext();
  const r = { stateAtCreate: ctx.state, decodedSeconds: null, wallMs: null, error: null };
  try {
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
    r.decodedSeconds = Math.round(buf.duration * 100) / 100;
    await Promise.race([ctx.resume(), wait(1500)]);
    r.stateAfterResume = ctx.state;
    if (ctx.state !== "running") return r;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1.5;
    src.connect(ctx.destination);
    const t0 = performance.now();
    await new Promise((res) => { src.onended = res; src.start(); setTimeout(res, 15000); });
    r.wallMs = Math.round(performance.now() - t0);
    r.expectedMs = Math.round((buf.duration / 1.5) * 1000);
  } catch (e) { r.error = String(e); }
  return r;
}

let mp3 = null;
document.getElementById("click-mp3").addEventListener("click", async () => {
  if (!mp3) return log("no mp3 yet");
  const a = await probeAudio(mp3);
  log("after click: " + JSON.stringify(a.unmuted));
  api.postMessage({ type: "manual", afterClick: a.unmuted });
});
window.addEventListener("message", async (e) => {
  const m = e.data;
  if (m.mp3) mp3 = m.mp3;
  if (m.type === "ping") api.postMessage({ type: "pong" });
  if (m.type === "probe") {
    log("probing voices...");
    const voices = await probeVoices();
    log(JSON.stringify(voices, null, 1));
    log("probing mp3 blob at 1.5x...");
    const audio = await probeAudio(m.mp3);
    log(JSON.stringify(audio, null, 1));
    api.postMessage({ type: "result", voices, audio });
  }
});
</script></body></html>`;
}

async function run(context) {
  const result = { platform: process.platform, release: os.release(), vscode: vscode.version, appName: vscode.env.appName, when: new Date().toISOString() };
  const out = vscode.window.createOutputChannel("ReadLoudly Spike");
  out.show(true);
  const say = (m) => out.appendLine(m);

  result.os = [];
  for (let i = 0; i < 3; i++) result.os.push(await timeOsEngine());
  say("os engine: " + JSON.stringify(result.os));

  const panel = vscode.window.createWebviewPanel("readloudlySpike", "ReadLoudly Spike", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  let boots = 0;
  const waitFor = (type, ms) => new Promise((resolve) => {
    const sub = panel.webview.onDidReceiveMessage((m) => { if (m.type === type) { sub.dispose(); resolve(m); } });
    setTimeout(() => { sub.dispose(); resolve(null); }, ms);
  });
  panel.webview.onDidReceiveMessage((m) => { if (m.type === "boot") boots++; });
  const booted = waitFor("boot", 10000);
  panel.webview.html = html(panel.webview, crypto.randomBytes(16).toString("base64"), "probe");
  await booted;

  const mp3 = fs.readFileSync(path.join(context.extensionPath, "media", "sample.mp3")).toString("base64");
  const probed = waitFor("result", 45000);
  panel.webview.postMessage({ type: "probe", mp3 });
  const probe = await probed;
  result.webview = probe ? { voices: probe.voices, audio: probe.audio } : { error: "no result within 45 s" };
  say("webview: " + JSON.stringify(result.webview));
  if (process.platform === "darwin") result.hostAfplay = await timeHostPlayer("afplay", ["-r", "1.5", path.join(context.extensionPath, "media", "sample.mp3")]);

  const known = new Set(await vscode.commands.getCommands(true));
  result.float = {};
  panel.reveal(vscode.ViewColumn.Active);
  for (const id of FLOAT_COMMANDS) {
    if (!known.has(id)) { result.float[id] = "missing"; continue; }
    try { await vscode.commands.executeCommand(id); result.float[id] = "ok"; } catch (e) { result.float[id] = String(e.message || e); }
    await new Promise((r) => setTimeout(r, 800));
  }
  const pong = waitFor("pong", 4000);
  panel.webview.postMessage({ type: "ping" });
  result.float.webviewAliveAfterMove = Boolean(await pong);
  panel.webview.postMessage({ type: "load", mp3 });
  result.float.webviewBoots = boots;
  say("float: " + JSON.stringify(result.float));

  const dir = path.join(context.extensionPath, "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${process.platform}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  say("wrote " + file);
  panel.webview.onDidReceiveMessage((m) => {
    if (m.type !== "manual") return;
    result.manualAfterClick = m.afterClick;
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    say("manual click result: " + JSON.stringify(m.afterClick));
  });
  if (process.env.RL_SPIKE_AUTOQUIT) setTimeout(() => vscode.commands.executeCommand("workbench.action.quit"), Number(process.env.RL_SPIKE_AUTOQUIT));
}

exports.activate = (context) => {
  context.subscriptions.push(vscode.commands.registerCommand("readloudlySpike.run", () => run(context)));
  run(context).catch((e) => vscode.window.showErrorMessage("Spike failed: " + e.message));
};
exports.deactivate = () => {};
