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
export function jsonError(error: unknown): NextResponse {
  const appError = normalizeError(error);
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

/** 包裹 Route Handler：把抛出的错误统一转成契约失败信封，避免 500 裸抛。 */
export function withRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return jsonError(error);
    }
  };
}
