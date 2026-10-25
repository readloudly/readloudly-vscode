// Drives a spike started with `spike/run.sh --remote-debugging-port=9333`: node spike/cdp.mjs audio | minsize | geom | bounds | set <l> <t> <w> <h> | replay | quit
const PORT = 9333;
const step = process.argv[2];
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else events.push(m);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const { targetInfos } = await send("Target.getTargets");
const aux = targetInfos.find((t) => t.type === "page" && t.title.includes("ReadLoudly Spike"));
const frame = targetInfos.find((t) => t.type === "iframe" && t.url.startsWith("vscode-webview://"));
let auxSession;
const auxEval = async (expression) => {
  auxSession ??= (await send("Target.attachToTarget", { targetId: aux.targetId, flatten: true })).sessionId;
  return (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, auxSession)).result.value;
};
const win = () => auxEval("({ left: screenX, top: screenY, width: outerWidth, height: outerHeight })");

async function webviewContext() {
  const { sessionId } = await send("Target.attachToTarget", { targetId: frame.targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await wait(500);
  const ctxs = events.filter((e) => e.method === "Runtime.executionContextCreated" && e.sessionId === sessionId).map((e) => e.params.context.id);
  for (const contextId of ctxs) {
    const r = await send("Runtime.evaluate", { contextId, expression: "!!document.getElementById('click-mp3')", returnByValue: true }, sessionId);
    if (r.result.value) return { sessionId, contextId };
  }
  throw new Error("spike page context not found in " + ctxs.length + " contexts");
}
const evalIn = (c, expression, extra = {}) => send("Runtime.evaluate", { contextId: c.contextId, expression, returnByValue: true, awaitPromise: true, ...extra }, c.sessionId).then((r) => r.result.value);

if (step === "audio") {
  const c = await webviewContext();
  console.log("activation before:", await evalIn(c, "JSON.stringify(navigator.userActivation)"));
  await evalIn(c, "document.getElementById('click-mp3').click()", { userGesture: true });
  await wait(7000);
  console.log("activation after click:", await evalIn(c, "JSON.stringify({hasBeenActive: navigator.userActivation.hasBeenActive, isActive: navigator.userActivation.isActive})"));
  await evalIn(c, "window.postMessage({ type: 'replay' }, '*')");
  await wait(7000);
  console.log("log tail:", (await evalIn(c, "document.getElementById('log').textContent")).split("\n").slice(-3).join(" | "));
}
if (step === "minsize") {
  console.log("start", JSON.stringify(await win()));
  for (const [w, h] of [[340, 80], [100, 40]]) {
    await auxEval(`resizeTo(${w}, ${h})`);
    await wait(700);
    console.log(`asked ${w}x${h} ->`, JSON.stringify(await win()));
  }
}
if (step === "bounds") console.log(JSON.stringify(await win()));
if (step === "set") {
  const [left, top, width, height] = process.argv.slice(3).map(Number);
  await auxEval(`moveTo(${left}, ${top}); resizeTo(${width}, ${height})`);
  await wait(700);
  console.log("now", JSON.stringify(await win()));
}
if (step === "geom") {
  const a = await auxEval(`(() => { const f = [...document.querySelectorAll('iframe')].map((i) => i.getBoundingClientRect()).find((b) => b.width > 0); return { screenX, screenY, chrome: outerHeight - innerHeight, iframe: f && { x: f.x, y: f.y, w: f.width, h: f.height } }; })()`);
  const c = await webviewContext();
  const pill = await evalIn(c, "(() => { const p = document.getElementById('pill'); const b = p.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, region: getComputedStyle(p).webkitAppRegion || getComputedStyle(p).getPropertyValue('app-region'), button: (({ x, y, width, height }) => ({ x, y, width, height }))(document.getElementById('click-mp3').getBoundingClientRect()) }; })()");
  console.log(JSON.stringify({ aux: a, pill }));
}
if (step === "replay") {
  const c = await webviewContext();
  console.log("activation:", await evalIn(c, "JSON.stringify({ hasBeenActive: navigator.userActivation.hasBeenActive, isActive: navigator.userActivation.isActive })"));
  await evalIn(c, "window.postMessage({ type: 'replay' }, '*')");
  await wait(7000);
  console.log("log tail:", (await evalIn(c, "document.getElementById('log').textContent")).split("\n").slice(-3).join(" | "));
}
if (step === "quit") {
  const c = await webviewContext();
  await evalIn(c, "api.postMessage({ type: 'quit' })");
  console.log("quit sent");
}
ws.close();
