import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  run(args: Record<string, unknown>): string | Promise<string>;
}

const MAX_BODY = 1 << 20;

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return void (req.destroy(), reject(new Error('too large')));
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

// ponytail: MCP over streamable HTTP with plain JSON replies (no SSE, no batches), which is all a tool server needs.
export async function startMcp(
  tools: Tool[],
  version: string
): Promise<{ url: string; server: Server }> {
  const path = `/mcp/${randomBytes(24).toString('base64url')}`;
  const server = createServer(async (req, res) => {
    const reply = (status: number, json?: unknown) => {
      res.writeHead(status, json === undefined ? {} : { 'content-type': 'application/json' });
      res.end(json === undefined ? undefined : JSON.stringify(json));
    };
    const { port } = server.address() as AddressInfo;
    // Browsers always send Origin, so this keeps web pages (and DNS rebinding) away from the local server.
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}` || req.url !== path)
      return reply(403);
    if (req.method !== 'POST') return reply(405);
    let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(await body(req));
    } catch {
      return reply(400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
    if (msg.id === undefined) return reply(202);
    const ok = (result: unknown) => reply(200, { jsonrpc: '2.0', id: msg.id, result });
    const fail = (code: number, message: string) =>
      reply(200, { jsonrpc: '2.0', id: msg.id, error: { code, message } });
    if (msg.method === 'initialize')
      return ok({
        protocolVersion: msg.params?.protocolVersion ?? '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'readloudly', version },
      });
    if (msg.method === 'ping') return ok({});
    if (msg.method === 'tools/list')
      return ok({
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    if (msg.method !== 'tools/call') return fail(-32601, 'Method not found');
    const tool = tools.find((t) => t.name === msg.params?.name);
    if (!tool) return fail(-32602, 'Unknown tool');
    try {
      const text = await tool.run((msg.params?.arguments as Record<string, unknown>) ?? {});
      ok({ content: [{ type: 'text', text }] });
    } catch (e) {
      ok({
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      });
    }
  });
  await new Promise<void>((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, server };
}
