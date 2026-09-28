/**
 * `POST /api/uploads` —— 图片上传（MEMBER）。
 *
 * 契约：docs/api-contract.md §3 → `201 { data: { key, url } }`；
 * 错误 `INVALID_INPUT`(非 multipart / 缺 file / 类型不合法)、`PAYLOAD_TOO_LARGE`(>5MB)、`RATE_LIMITED`。
 *
 * 顺序（有意为之）：**先守卫、再限流、后解析**——限流要挡在磁盘写入之前；
 * 而匿名请求根本不该占用令牌（否则未登录者可打满全局桶）。
 */
import type { UploadResult } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { errors } from '@/server/errors';
import { jsonCreated, withRoute } from '@/server/http';
import { enforceUploadRateLimit, putUpload } from '@/server/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 从 `multipart/form-data` 取 `file` 字段；形态不对一律 `INVALID_INPUT`（属请求边界，不是内部假设）。 */
async function readFormFile(request: Request): Promise<File> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw errors.invalidInput('请求体需为 multipart/form-data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw errors.invalidInput('缺少 file 字段');
  }
  return file;
}

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);
  enforceUploadRateLimit(viewer.id);

  const file = await readFormFile(request);
  const data: UploadResult = await putUpload(file);
  return jsonCreated(data);
});
