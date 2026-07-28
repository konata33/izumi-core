import type { AuthToken } from './core';

export type Session = {
  accessToken: string;
  expiresAt: number;
};

const storageKey = 'izumi-admin.session.v1';

export function getSession(): Session | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const session = JSON.parse(raw) as Session;

    if (!session.accessToken || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      clearSession();
      return undefined;
    }

    return session;
  } catch {
    clearSession();
    return undefined;
  }
}

export function saveSession(token: AuthToken): Session {
  const session: Session = {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1_000,
  };
  window.localStorage.setItem(storageKey, JSON.stringify(session));
  return session;
}

export function clearSession(): void {
  window.localStorage.removeItem(storageKey);
}
