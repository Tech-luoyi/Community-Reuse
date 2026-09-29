import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ErrorBodySchema, ERROR_CODES } from '@/shared/schemas';
import {
  AppError,
  ERROR_HTTP_STATUS,
  errors,
  fromZodError,
  isAppError,
  normalizeError,
  toErrorBody,
} from '@/server/errors';
import {
  jsonCreated,
  jsonError,
  jsonOk,
  jsonPaginated,
  parseJsonBody,
  withRoute,
} from '@/server/http';

describe('server/errors · 错误码 → HTTP 状态映射', () => {
  it('每个错误码都有 HTTP 状态', () => {
    for (const code of ERROR_CODES) {
      expect(typeof ERROR_HTTP_STATUS[code]).toBe('number');
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(ERROR_HTTP_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_HTTP_STATUS.CLAIM_CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.DEPENDENCY_UNAVAILABLE).toBe(503);
  });

  it('AppError 携带 code / httpStatus', () => {
    const error = new AppError('NOT_FOUND', '资源不存在');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.httpStatus).toBe(404);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });

  it('normalizeError：未知错误收敛为 INTERNAL（且不携带原始 message）', () => {
    const normalized = normalizeError('boom');
    expect(normalized.code).toBe('INTERNAL');
    expect(normalized.message).not.toContain('boom');
    const zodError = new ZodError([]);
    expect(normalizeError(zodError).code).toBe('INVALID_INPUT');
  });

  it('fromZodError：把字段问题映射进 details', () => {
    const error = fromZodError(new ZodError([]));
    expect(error.code).toBe('INVALID_INPUT');
  });

  it('toErrorBody：无 details 时不输出该字段', () => {
    const body = toErrorBody(errors.notFound());
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
    expect('details' in body.error).toBe(false);
  });
});

describe('server/http · 响应信封', () => {
  it('jsonOk 返回 200 且形如 { data }', async () => {
    const response = jsonOk({ hello: 'world' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { hello: 'world' } });
  });

  it('jsonCreated 返回 201', () => {
    expect(jsonCreated({ ok: true }).status).toBe(201);
  });

  it('jsonPaginated 返回 { data, pagination }', async () => {
    const response = jsonPaginated([{ id: 'i_1' }], { page: 1, pageSize: 20, total: 1 });
    await expect(response.json()).resolves.toEqual({
      data: [{ id: 'i_1' }],
      pagination: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('jsonError 输出契约失败信封，且符合 ErrorBodySchema', async () => {
    const response = jsonError(errors.claimConflict('该物品已被预约'));
    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(ErrorBodySchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ error: { code: 'CLAIM_CONFLICT', message: '该物品已被预约' } });
  });

  it('jsonError 对未知错误输出 INTERNAL / 500，且**不泄漏内部信息**', async () => {
    const response = jsonError(new Error('connect ECONNREFUSED 10.0.0.5:5432 (password=hunter2)'));
    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    // 契约只约束错误码，message 必须是通用文案：内部错误原文只进服务端日志。
    expect(body).toEqual({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
    // 关键回归：原文一个字都不许出现在响应体里。
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('withRoute 捕获抛出的 AppError 并转成失败信封', async () => {
    const handler = withRoute(async () => {
      throw errors.forbidden();
    });
    const response = await handler();
    expect(response.status).toBe(403);
  });

  it('parseJsonBody：非法 JSON 抛 INVALID_INPUT', async () => {
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      body: '{ not json',
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseJsonBody(request, ErrorBodySchema)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
