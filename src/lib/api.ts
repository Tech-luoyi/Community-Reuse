/**
 * 前端唯一的 HTTP 出入口。
 *
 * 纪律（api-contract.md §10）：
 *   · 响应体形状一律由 `src/shared/schemas.ts` 的 Zod schema 定义，本模块**在运行时校验每个响应**，
 *     因此页面里的类型全部来自 `z.infer`，不存在前端手写的本地 interface。
 *   · 失败信封 `{ error: { code, message, details? } }` 解析不出契约错误码时归 `INTERNAL`，
 *     绝不静默吞掉。
 *   · Cookie 是 HttpOnly 的 `cr_session`，所以每个请求都必须 `credentials: 'include'`。
 */
import type { z } from 'zod';

import { ErrorBodySchema, paginatedEnvelope, successEnvelope } from '@/shared/schemas';
import type { ErrorDetail, ErrorCode, Pagination } from '@/shared/types';

/** 契约错误码全集之外的兜底（响应体根本不是契约信封，例如 405 返回的 HTML）。 */
export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  public readonly code: ClientErrorCode;
  public readonly status: number;
  public readonly details?: ErrorDetail[];

  public constructor(
    code: ClientErrorCode,
    message: string,
    status: number,
    details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  public get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.status === 401;
  }

  public get isConflict(): boolean {
    return this.code === 'CLAIM_CONFLICT' || this.code === 'CONFLICT';
  }

  public get isRateLimited(): boolean {
    return this.code === 'RATE_LIMITED';
  }

  /** `details` → react-hook-form 的 `setError` 入参（`path` 即字段名）。 */
  public fieldErrors(): { path: string; message: string }[] {
    return this.details ?? [];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** 把任意 unknown 收敛成可展示文案；优先用服务端给的 message（§0.1）。 */
export function toMessage(value: unknown, fallback: string): string {
  if (isApiError(value)) return value.message;
  if (value instanceof Error && value.message.length > 0) return value.message;
  return fallback;
}

export type QueryValue = string | number | boolean | null | undefined;

/**
 * 序列化查询串。调用方负责**省略默认值**（`status=ACTIVE` / `sort=latest` / `page=1`），
 * 这样 React Query 的 cache key 在各页面之间保持短且一致。
 */
export function buildQueryString(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export interface ListResult<T> {
  data: T[];
  pagination: Pagination;
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

function parseJsonOrNone(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(status: number, json: unknown): ApiError {
  const parsed = ErrorBodySchema.safeParse(json);
  if (parsed.success) {
    return new ApiError(
      parsed.data.error.code,
      parsed.data.error.message,
      status,
      parsed.data.error.details,
    );
  }
  return new ApiError('INTERNAL', `请求失败（HTTP ${status}）`, status);
}

async function call(path: string, options: CallOptions): Promise<unknown> {
  const { method = 'GET', body, query, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${path}${buildQueryString(query)}`, {
      method,
      credentials: 'include',
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // 主动 abort 不是错误，交给调用方（React Query 会自动忽略）
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK', '网络不可用，请检查连接后重试', 0);
  }

  const json = parseJsonOrNone(await response.text());
  if (!response.ok) throw toApiError(response.status, json);
  return json;
}

/** 成功信封 `{ data }` 的运行时校验；不匹配即视为契约漂移，显式报错而非静默 undefined。 */
async function callOne<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: CallOptions,
): Promise<z.infer<S>> {
  const json = await call(path, options);
  const parsed = successEnvelope(schema).safeParse(json);
  if (!parsed.success) {
    throw new ApiError('INTERNAL', `响应不符合契约（${path}）`, 200);
  }
  return parsed.data.data;
}

/** 列表信封 `{ data: T[], pagination }` 的运行时校验。 */
async function callList<S extends z.ZodTypeAny>(
  path: string,
  itemSchema: S,
  options: CallOptions,
): Promise<ListResult<z.infer<S>>> {
  const json = await call(path, options);
  const parsed = paginatedEnvelope(itemSchema).safeParse(json);
  if (!parsed.success) {
    throw new ApiError('INTERNAL', `响应不符合契约（${path}）`, 200);
  }
  return { data: parsed.data.data, pagination: parsed.data.pagination };
}

export const api = {
  get: <S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    query?: Record<string, QueryValue>,
    signal?: AbortSignal,
  ): Promise<z.infer<S>> => callOne(path, schema, { method: 'GET', query, signal }),

  list: <S extends z.ZodTypeAny>(
    path: string,
    itemSchema: S,
    query?: Record<string, QueryValue>,
    signal?: AbortSignal,
  ): Promise<ListResult<z.infer<S>>> =>
    callList(path, itemSchema, { method: 'GET', query, signal }),

  post: <S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<z.infer<S>> => callOne(path, schema, { method: 'POST', body, signal }),

  patch: <S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown): Promise<z.infer<S>> =>
    callOne(path, schema, { method: 'PATCH', body }),
};
