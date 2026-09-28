/**
 * 统一错误类型与错误码。
 *
 * 契约：docs/api-contract.md §0.2（错误码表）/ §0.1（失败信封结构）。
 * 规则：业务代码抛 `AppError`；由 src/server/http.ts 的 `jsonError` 统一序列化。
 */
import { ZodError } from 'zod';

import type { ErrorBody, ErrorCode, ErrorDetail } from '@/shared/schemas';

/** 错误码 → HTTP 状态码（与 api-contract.md §0.2 完全一致）。 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CLAIM_CONFLICT: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DEPENDENCY_UNAVAILABLE: 503,
};

/** 业务错误：携带契约错误码 + 对应 HTTP 状态 + 可选字段明细。 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: ErrorDetail[];

  public constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

/** ZodError → ErrorDetail[]（`details` 为字段错误列表）。 */
export function toErrorDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** 便捷工厂：统一构造带默认文案的 AppError。 */
export const errors = {
  invalidInput: (message = '请求参数校验失败', details?: ErrorDetail[]): AppError =>
    new AppError('INVALID_INPUT', message, details),
  unauthenticated: (message = '未登录或会话已失效'): AppError =>
    new AppError('UNAUTHENTICATED', message),
  forbidden: (message = '无权执行该操作'): AppError => new AppError('FORBIDDEN', message),
  notFound: (message = '资源不存在'): AppError => new AppError('NOT_FOUND', message),
  claimConflict: (message = '状态冲突，操作未生效'): AppError =>
    new AppError('CLAIM_CONFLICT', message),
  conflict: (message = '唯一约束冲突'): AppError => new AppError('CONFLICT', message),
  payloadTooLarge: (message = '上传内容超出限制'): AppError =>
    new AppError('PAYLOAD_TOO_LARGE', message),
  rateLimited: (message = '请求过于频繁，请稍后再试'): AppError =>
    new AppError('RATE_LIMITED', message),
  internal: (message = '服务器内部错误'): AppError => new AppError('INTERNAL', message),
  dependencyUnavailable: (message = '依赖服务不可用'): AppError =>
    new AppError('DEPENDENCY_UNAVAILABLE', message),
} as const;

/** Zod 校验失败 → INVALID_INPUT（含字段明细）。 */
export function fromZodError(error: ZodError): AppError {
  return errors.invalidInput('请求参数校验失败', toErrorDetails(error));
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** 任何 unknown 错误 → AppError（未知错误收敛为 INTERNAL）。 */
export function normalizeError(value: unknown): AppError {
  if (isAppError(value)) {
    return value;
  }
  if (value instanceof ZodError) {
    return fromZodError(value);
  }
  return errors.internal(value instanceof Error ? value.message : '未知错误');
}

/** AppError → 契约失败信封。 */
export function toErrorBody(error: AppError): ErrorBody {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (error.details && error.details.length > 0) {
    body.error.details = error.details;
  }
  return body;
}
