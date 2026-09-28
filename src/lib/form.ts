import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { isApiError } from '@/lib/api';

/**
 * 把契约失败信封里的 `details[]`（`{ path, message }`）落到表单字段上。
 *
 * 服务端已经做过同样的 Zod 校验，所以字段级报错以服务端文案为准，
 * 前端规则只负责即时反馈，不承担最终判定（见 api-contract.md §0.1）。
 * 返回是否落上了至少一个字段错，调用方据此决定要不要再补一条整体提示。
 */
export function applyApiFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
): boolean {
  if (!isApiError(error)) return false;
  const entries = error.fieldErrors();
  if (entries.length === 0) return false;

  for (const detail of entries) {
    // 服务端 `path` 就是契约字段名，与表单的字段名一一对应
    setError(detail.path as Path<T>, { message: detail.message });
  }
  return true;
}
