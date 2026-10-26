import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startMcp, type Tool } from './mcp.ts';

let ran = 0;
const echo: Tool = {
  name: 'echo',
  description: 'Echo the text back',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  run: (args) => (++ran, `said ${String(args.text)}`),
};
const boom: Tool = {
  name: 'boom',
  description: 'Always throws',
  inputSchema: { type: 'object' },
  run: () => {
    throw new Error('kaput');
  },
};

interface Reply {
  result: {
    serverInfo: { name: string; version: string };
    capabilities: { tools?: object };
    tools: Tool[];
    content: { text: string }[];
    isError?: boolean;
  };
  error: { code: number };
}

let url: string;
let close: () => Promise<void>;

before(async () => {
  const { url: u, server } = await startMcp([echo, boom], '9.9.9');
  url = u;
  close = () =>
    new Promise((resolve) => (server.close(() => resolve()), server.closeAllConnections()));
});
after(() => close());

const rpc = async (method: string, params?: object, id: number | null = 1) => {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }),
  });
  return {
    status: res.status,
    json: res.status === 200 ? ((await res.json()) as Reply) : (undefined as unknown as Reply),
  };
};

const raw = (opts: { method?: string; path?: string; headers?: Record<string, string> }) =>
  new Promise<number>((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        method: opts.method ?? 'POST',
        path: opts.path ?? u.pathname,
        headers: opts.headers,
      },
      (res) => (res.resume(), resolve(res.statusCode ?? 0))
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'x' } },
      })
    );
  });

test('url is loopback with a long secret path token', () => {
  const u = new URL(url);
  assert.equal(u.hostname, '127.0.0.1');
  assert.ok(u.pathname.startsWith('/mcp/') && u.pathname.length >= 30);
});

test('initialize reports the server and the tools capability', async () => {
  const { json } = await rpc('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(json.result.serverInfo.name, 'readloudly');
  assert.equal(json.result.serverInfo.version, '9.9.9');
  assert.ok(json.result.capabilities.tools);
});

test('tools/list exposes name, description and inputSchema but not run', async () => {
  const { json } = await rpc('tools/list');
  const tool = json.result.tools.find((t) => t.name === 'echo');
  assert.deepEqual(tool, {
    name: 'echo',
    description: echo.description,
    inputSchema: echo.inputSchema,
  });
});

test('tools/call runs the tool with its arguments', async () => {
  const { json } = await rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } });
  assert.deepEqual(json.result.content, [{ type: 'text', text: 'said hi' }]);
  assert.equal(json.result.isError, undefined);
});

test('a throwing tool becomes an isError result', async () => {
  const { json } = await rpc('tools/call', { name: 'boom' });
  assert.equal(json.result.isError, true);
  assert.equal(json.result.content[0]?.text, 'kaput');
});

test('unknown tool and unknown method return JSON-RPC errors', async () => {
  assert.equal((await rpc('tools/call', { name: 'nope' })).json.error.code, -32602);
  assert.equal((await rpc('resources/list')).json.error.code, -32601);
});

test('ping answers and a notification gets 202', async () => {
  assert.deepEqual((await rpc('ping')).json.result, {});
  assert.equal((await rpc('notifications/initialized', undefined, null)).status, 202);
});

test('a malformed body is a parse error', async () => {
  const res = await fetch(url, { method: 'POST', body: '{nope' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Reply).error.code, -32700);
});

test('rejects Origin, foreign Host and wrong path before running any tool', async () => {
  const ranBefore = ran;
  const { port } = new URL(url);
  assert.equal(
    await raw({ headers: { origin: 'https://evil.example', host: `127.0.0.1:${port}` } }),
    403
  );
  assert.equal(await raw({ headers: { host: `localhost:${port}` } }), 403);
  assert.equal(await raw({ path: '/mcp/wrong-token' }), 403);
  assert.equal(ran, ranBefore);
});

test('non-POST on the right path is 405', async () => {
  assert.equal((await fetch(url)).status, 405);
});

test('a body over 1 MiB is cut off without running the tool, and the server keeps serving', async () => {
  const ranBefore = ran;
  const text = 'x'.repeat((1 << 20) + 1);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'echo', arguments: { text } },
  });
  const status = await fetch(url, { method: 'POST', body }).then(
    (r) => r.status,
    () => 0
  );
  assert.notEqual(status, 200);
  assert.equal(ran, ranBefore);
  assert.deepEqual((await rpc('ping')).json.result, {});
});
