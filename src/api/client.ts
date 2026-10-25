export interface Tokens {
  access: string;
  refresh?: string;
}

export interface Session {
  get(): Promise<Tokens | undefined>;
  set(tokens: Tokens | undefined): Promise<void>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Request = (path: string, init?: RequestInit) => Promise<Response>;

// The backend reads some routes only from cookies, named per environment; native picks them the same way.
const cookieNames = (baseUrl: string) => {
  const suffix = new URL(baseUrl).host === 'api.readloudly.com' ? '' : '-dev';
  return { access: `rl-user-token${suffix}`, refresh: `rl-user-refresh-token${suffix}` };
};

const readCookie = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!.split('='))
    .find(([k]) => k === name)?.[1];

// Bearer plus cookie on every call, and at most one refresh per call, so a dead session can never loop.
export function createClient(baseUrl: string, session: Session, fetchImpl = fetch): Request {
  const names = cookieNames(baseUrl);
  const send = (path: string, init: RequestInit, tokens?: Tokens) => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (tokens) {
      headers.set('authorization', `Bearer ${tokens.access}`);
      headers.set('cookie', `${names.access}=${tokens.access}`);
    }
    return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
  };

  async function refresh(tokens: Tokens): Promise<Tokens | undefined> {
    if (!tokens.refresh) return;
    // The refresh token is read only from its cookie, the body must be {} and the new token comes back only in Set-Cookie.
    const res = await fetchImpl(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json', cookie: `${names.refresh}=${tokens.refresh}` },
    });
    // Only a rejected refresh ends the session; a server or network failure keeps it for the next try.
    if (!res.ok && res.status !== 401 && res.status !== 403)
      throw new ApiError(res.status, 'ReadLoudly could not renew your session');
    const access = res.ok ? readCookie(res, names.access) : undefined;
    return access
      ? { access, refresh: readCookie(res, names.refresh) ?? tokens.refresh }
      : undefined;
  }
  // Clips are fetched three at a time, so their 401s share one refresh.
  let refreshing: Promise<Tokens | undefined> | undefined;
  const refreshOnce = (tokens: Tokens) =>
    (refreshing ??= refresh(tokens).finally(() => (refreshing = undefined)));

  return async (path, init = {}) => {
    const tokens = await session.get();
    let res = await send(path, init, tokens);
    if (res.status === 401 && tokens) {
      const fresh = await refreshOnce(tokens);
      await session.set(fresh);
      if (fresh) res = await send(path, init, fresh);
      if (res.status === 401) await session.set(undefined);
    }
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { message?: unknown; code?: string };
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : String(body.message ?? res.statusText);
    throw new ApiError(res.status, message, body.code);
  };
}

export type Action = 'credits' | 'standard' | 'retry' | 'device' | 'signIn';

// What the user can do about a failed Pro request; anything unknown (network included) falls back to the device voice.
export function describe(e: unknown): { action: Action; message: string } {
  if (!(e instanceof ApiError))
    return {
      action: 'device',
      message: 'ReadLoudly could not be reached, so the device voice is reading.',
    };
  if (e.status === 401)
    return { action: 'signIn', message: 'Your ReadLoudly session ended. Sign in again.' };
  if (e.code === 'FREE_TRIAL_EXHAUSTED' || /insufficient/i.test(e.message))
    return { action: 'credits', message: 'You are out of ReadLoudly credits.' };
  if (e.code === 'VOICE_NOT_IN_FREE_TIER')
    return { action: 'standard', message: 'This voice needs a Pro plan. Pick a standard voice.' };
  if (e.code === 'KOKORO_BUSY') return { action: 'retry', message: 'The voice server is busy.' };
  return { action: 'device', message: `${e.message}. The device voice is reading instead.` };
}
