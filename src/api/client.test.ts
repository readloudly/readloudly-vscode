import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createClient, describe, type Tokens } from './client.ts';

type Call = { url: string; init: RequestInit };

function fake(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function store(initial?: Tokens) {
  let tokens = initial;
  return {
    session: { get: async () => tokens, set: async (t?: Tokens) => void (tokens = t) },
    now: () => tokens,
  };
}

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

test('sends the token as Bearer and as the production access cookie', async () => {
  const { calls, fetchImpl } = fake([json(200, { ok: 1 })]);
  const { session } = store({ access: 'A', refresh: 'R' });
  await createClient('https://api.readloudly.com', session, fetchImpl)('/usage');
  assert.equal(calls[0]!.url, 'https://api.readloudly.com/usage');
  assert.equal(header(calls[0]!, 'authorization'), 'Bearer A');
  assert.equal(header(calls[0]!, 'cookie'), 'rl-user-token=A');
});

test('uses the -dev cookie names for any other API host', async () => {
  const { calls, fetchImpl } = fake([json(200, {})]);
  const { session } = store({ access: 'A' });
  await createClient('https://dev-be.example.com', session, fetchImpl)('/usage');
  assert.equal(header(calls[0]!, 'cookie'), 'rl-user-token-dev=A');
});

test('a 401 refreshes once through the refresh cookie, then retries with the new token', async () => {
  const { calls, fetchImpl } = fake([
    json(401, { statusCode: 401, message: 'Unauthorized' }),
    json(200, { success: true }, { 'set-cookie': 'rl-user-token=B; Path=/; HttpOnly' }),
    json(200, { ok: 1 }),
  ]);
  const { session, now } = store({ access: 'A', refresh: 'R' });
  const res = await createClient('https://api.readloudly.com', session, fetchImpl)('/usage');
  assert.equal(res.status, 200);
  assert.equal(calls[1]!.url, 'https://api.readloudly.com/auth/refresh');
  assert.equal(calls[1]!.init.method, 'POST');
  assert.equal(calls[1]!.init.body, '{}');
  assert.equal(header(calls[1]!, 'cookie'), 'rl-user-refresh-token=R');
  assert.equal(header(calls[2]!, 'authorization'), 'Bearer B');
  assert.deepEqual(now(), { access: 'B', refresh: 'R' });
});

test('a 401 after the refresh does not loop: it signs out and throws', async () => {
  const { calls, fetchImpl } = fake([
    json(401, {}),
    json(200, { success: true }, { 'set-cookie': 'rl-user-token=B' }),
    json(401, { statusCode: 401, message: 'Unauthorized' }),
  ]);
  const { session, now } = store({ access: 'A', refresh: 'R' });
  await assert.rejects(
    createClient('https://api.readloudly.com', session, fetchImpl)('/usage'),
    (e) => e instanceof ApiError && e.status === 401
  );
  assert.equal(calls.length, 3);
  assert.equal(now(), undefined);
});

test('a rejected refresh signs out without retrying', async () => {
  const { calls, fetchImpl } = fake([json(401, {}), json(401, {})]);
  const { session, now } = store({ access: 'A', refresh: 'R' });
  await assert.rejects(createClient('https://api.readloudly.com', session, fetchImpl)('/usage'));
  assert.equal(calls.length, 2);
  assert.equal(now(), undefined);
});

test('error bodies become an ApiError with status, code and message', async () => {
  const { fetchImpl } = fake([
    json(403, { statusCode: 403, message: 'Free trial used', code: 'FREE_TRIAL_EXHAUSTED' }),
  ]);
  const { session } = store({ access: 'A' });
  await assert.rejects(
    createClient('https://api.readloudly.com', session, fetchImpl)('/voices', { method: 'POST' }),
    (e) =>
      e instanceof ApiError &&
      e.status === 403 &&
      e.code === 'FREE_TRIAL_EXHAUSTED' &&
      e.message === 'Free trial used'
  );
});

test('describe maps each backend error to what the user can do next', () => {
  const err = (status: number, message: string, code?: string) =>
    new ApiError(status, message, code);
  assert.equal(describe(err(403, 'Insufficient premium voice credits')).action, 'credits');
  assert.equal(describe(err(403, 'x', 'FREE_TRIAL_EXHAUSTED')).action, 'credits');
  assert.equal(describe(err(403, 'x', 'VOICE_NOT_IN_FREE_TIER')).action, 'standard');
  assert.equal(describe(err(503, 'x', 'KOKORO_BUSY')).action, 'retry');
  assert.equal(describe(err(404, 'x', 'VOICE_UNAVAILABLE')).action, 'device');
  assert.equal(describe(err(401, 'x')).action, 'signIn');
  assert.equal(describe(new TypeError('fetch failed')).action, 'device');
});
