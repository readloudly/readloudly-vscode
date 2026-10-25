import * as vscode from 'vscode';
import type { Session, Tokens } from '../api/client.ts';

interface Stored extends Tokens {
  email: string;
}

const KEY = 'readloudly.session';

// Tokens live only in SecretStorage; the Accounts menu gets the email, never the token.
export class Account implements Session, vscode.AuthenticationProvider {
  private readonly changed =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changed.event;
  private readonly secrets: vscode.SecretStorage;
  private readonly apiUrl: () => string;

  constructor(secrets: vscode.SecretStorage, apiUrl: () => string) {
    this.secrets = secrets;
    this.apiUrl = apiUrl;
  }

  private async stored(): Promise<Stored | undefined> {
    const raw = await this.secrets.get(KEY);
    return raw ? (JSON.parse(raw) as Stored) : undefined;
  }

  async get() {
    return this.stored();
  }

  async set(tokens: Tokens | undefined) {
    const before = await this.stored();
    if (tokens && before) return this.secrets.store(KEY, JSON.stringify({ ...before, ...tokens }));
    if (!tokens && before) await this.signOut();
  }

  async email() {
    return (await this.stored())?.email;
  }

  async signIn(): Promise<boolean> {
    const email = await vscode.window.showInputBox({
      title: 'Sign in to ReadLoudly',
      prompt: 'Email',
      ignoreFocusOut: true,
      validateInput: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? undefined : 'Enter your email'),
    });
    if (!email) return false;
    const password = await vscode.window.showInputBox({
      title: 'Sign in to ReadLoudly',
      prompt: 'Password',
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) return false;
    const res = await fetch(`${this.apiUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    }).catch(() => undefined);
    if (!res?.ok) {
      void vscode.window.showErrorMessage(
        res && res.status < 500
          ? 'ReadLoudly: wrong email or password.'
          : 'ReadLoudly: could not reach ReadLoudly. Check your connection and try again.'
      );
      return false;
    }
    const body = (await res.json()) as { access_token: string; refresh_token?: string };
    const stored: Stored = {
      access: body.access_token,
      refresh: body.refresh_token,
      email: email.trim(),
    };
    await this.secrets.store(KEY, JSON.stringify(stored));
    this.changed.fire({ added: [session(stored.email)], removed: [], changed: [] });
    return true;
  }

  async signOut() {
    const before = await this.stored();
    await this.secrets.delete(KEY);
    if (before) this.changed.fire({ added: [], removed: [session(before.email)], changed: [] });
  }

  async getSessions() {
    const email = await this.email();
    return email ? [session(email)] : [];
  }

  async createSession() {
    if (!(await this.signIn())) throw new Error('Sign-in was cancelled');
    return session((await this.email())!);
  }

  async removeSession() {
    await this.signOut();
  }

  dispose() {
    this.changed.dispose();
  }
}

const session = (email: string): vscode.AuthenticationSession => ({
  id: 'readloudly',
  accessToken: '',
  account: { id: email, label: email },
  scopes: [],
});
