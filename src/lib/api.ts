import type { ErrorBody } from '@/shared/types';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: { path: string; message: string }[];

  constructor(
    code: string,
    message: string,
    status: number,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get isAuth() {
    return this.code === 'UNAUTHENTICATED' || this.status === 401;
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface RequestOptions extends RequestInit {
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { query, ...init } = options;
  const qs = query
    ? `?${new URLSearchParams(
        Object.entries(query).flatMap(([k, v]) =>
          v === undefined || v === null || v === '' ? [] : [[k, String(v)]],
        ),
      ).toString()}`
    : '';
  const res = await fetch(`${path}${qs}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) {
    const body = (json ?? {}) as Partial<ErrorBody>;
    throw new ApiError(
      body.error?.code ?? 'INTERNAL',
      body.error?.message ?? `请求失败 (${res.status})`,
      res.status,
      body.error?.details,
    );
  }
  return (json as { data: T }).data;
}

export const get = <T>(path: string, query?: RequestOptions['query'], init?: RequestInit) =>
  api<T>(path, { ...init, method: 'GET', query });

export const post = <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
  api<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    query,
  });

export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });

export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/* ---------- typed helpers (shapes follow docs/api-contract.md) ---------- */

import type { ItemDto, Pagination } from '@/shared/types';

export interface ListResult<T> {
  items: T[];
  pagination: Pagination;
}

export async function fetchItems(query: Record<string, string | number | boolean | undefined>) {
  const res = await fetch(
    `/api/items?${new URLSearchParams(
      Object.entries(query).flatMap(([k, v]) =>
        v === undefined || v === null || v === '' ? [] : [[k, String(v)]],
      ),
    ).toString()}`,
    { credentials: 'include' },
  );
  const json = await res.json();
  if (!res.ok)
    throw new ApiError(
      json.error?.code ?? 'INTERNAL',
      json.error?.message ?? '加载失败',
      res.status,
    );
  return json as { data: ItemDto[]; pagination: Pagination };
}
