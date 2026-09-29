/**
 * Route Handler 辅助：统一响应信封 + 请求体/查询串校验 + 错误收敛。
 *
 * 契约：docs/api-contract.md §0.1（成功 `{data, pagination?}` / 失败 `{error}`）。
 * 纪律：本模块只 import `next/server`、`zod`、`src/shared/**`、`src/server/**`。
 */
import { NextResponse } from 'next/server';
import type { ZodError, ZodTypeAny } from 'zod';
import { z } from 'zod';

import type { ErrorDetail, Pagination } from '@/shared/schemas';

import { errors, normalizeError, toErrorBody } from './errors';
import { log, resolveRequestId } from './logger';

/** 成功信封：`{ data }`。 */
export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/** 创建成功：201 `{ data }`。 */
export function jsonCreated<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

/** 列表成功：`{ data, pagination }`。 */
export function jsonPaginated<T>(data: T[], pagination: Pagination): NextResponse {
  return NextResponse.json({ data, pagination }, { status: 200 });
}

/** 失败信封：`{ error: { code, message, details? } }`，HTTP 状态由错误码决定。 */
export function jsonError(error: unknown, context?: Record<string, unknown>): NextResponse {
  const appError = normalizeError(error, context);
  return NextResponse.json(toErrorBody(appError), { status: appError.httpStatus });
}

function toDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** 解析并校验 JSON 请求体。非法 JSON 或校验失败均抛 INVALID_INPUT。 */
export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw errors.invalidInput('请求体必须是合法 JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw errors.invalidInput('请求参数校验失败', toDetails(result.error));
  }
  return result.data;
}

/** 解析并校验 URL 查询串（多值取首个；数值/布尔由 schema 负责 coerce）。 */
export function parseSearchParams<S extends ZodTypeAny>(request: Request, schema: S): z.infer<S> {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw errors.invalidInput('查询参数校验失败', toDetails(result.error));
  }
  return result.data;
}

/**
 * 包裹 Route Handler：把抛出的错误统一转成契约失败信封，避免 500 裸抛。
 *
 * 顺带做三件之前缺失的事（评审结论「每个请求可归因」）：
 *   1. **请求关联 ID**：取 `x-request-id` 或生成 UUID，回写 `x-request-id` 响应头；
 *      客户端报障时提供这个 ID，服务端就能定位到那一行日志。
 *   2. **access log**：每个请求一行 `{method, path, status, durationMs, requestId}`。
 *   3. **错误归因入日志**：`normalizeError` 的 `context` 里带上 method/path/requestId，
 *      而响应体只留通用文案。
 *
 * 签名保持 `(...args) => Response`，调用方无感。
 */
export function withRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    const request = args[0] as Request | undefined;
    const requestId =
      request instanceof Request
        ? resolveRequestId(request)
        : `local-${Math.random().toString(36).slice(2, 10)}`;
    const method = request instanceof Request ? request.method : 'LOCAL';
    let path = 'unknown';
    try {
      path = request instanceof Request ? new URL(request.url).pathname : 'unknown';
    } catch {
      path = 'unparsable';
    }
    const startedAt = Date.now();

    const withRequestId = (response: Response): Response => {
      try {
        response.headers.set('x-request-id', requestId);
      } catch {
        // 响应头不可变（如某些测试构造的 Response）时忽略：ID 仍会出现在日志里。
      }
      return response;
    };

    try {
      const response = await handler(...args);
      log.info('http.access', {
        requestId,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return withRequestId(response);
    } catch (error) {
      const response = jsonError(error, { requestId, method, path });
      log.info('http.access', {
        requestId,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        failed: true,
      });
      return withRequestId(response);
    }
  };
}
