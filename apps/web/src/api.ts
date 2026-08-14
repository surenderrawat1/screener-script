const TOKEN_KEY = 'sv_access_token';
const REFRESH_TOKEN_KEY = 'sv_refresh_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function setRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/** Turn Zod flatten / string / nested API errors into a short user-facing message. */
export function formatApiError(data: Record<string, unknown>, raw: string, status: number): string {
  const err = data.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const flat = err as { formErrors?: unknown; fieldErrors?: unknown; message?: unknown };
    const parts: string[] = [];
    if (Array.isArray(flat.formErrors)) {
      for (const msg of flat.formErrors) {
        if (typeof msg === 'string' && msg.trim()) parts.push(msg.trim());
      }
    }
    if (flat.fieldErrors && typeof flat.fieldErrors === 'object') {
      for (const [field, msgs] of Object.entries(flat.fieldErrors as Record<string, unknown>)) {
        if (!Array.isArray(msgs) || msgs.length === 0) continue;
        const text = msgs
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .join(', ');
        if (text) parts.push(`${field}: ${text}`);
      }
    }
    if (parts.length) return parts.join(' · ');
    if (typeof flat.message === 'string' && flat.message.trim()) return flat.message.trim();
  }
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  return raw.trim().slice(0, 240) || `HTTP ${status}`;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const refreshToken = getRefreshToken();
  const didRefresh = (options as any).__sv_did_refresh === true;
  const hasBody = options.body !== undefined && options.body !== null && options.body !== '';

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (hasBody && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401 && refreshToken && !didRefresh) {
    // Access token might be expired — try refresh once, then retry original request.
    try {
      const refreshRes = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const refreshRaw = await refreshRes.text();
      let refreshData: Record<string, unknown> = {};
      try {
        refreshData = refreshRaw ? (JSON.parse(refreshRaw) as Record<string, unknown>) : {};
      } catch {
        refreshData = {};
      }
      if (refreshRes.ok) {
        const nextAccessToken = refreshData.accessToken;
        const nextRefreshToken = refreshData.refreshToken;
        if (typeof nextAccessToken === 'string') {
          setToken(nextAccessToken);
          if (typeof nextRefreshToken === 'string') setRefreshToken(nextRefreshToken);
          return api<T>(path, { ...options, __sv_did_refresh: true } as any);
        }
      }
    } catch {
      // fall through to original error
    }
    clearToken();
  }

  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(formatApiError(data, raw, res.status));
  return data as T;
}
