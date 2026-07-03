const TOKEN_KEY = 'sv_access_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const hasBody = options.body !== undefined && options.body !== null && options.body !== '';
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (hasBody && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : raw.trim().slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}
