/**
 * 上传入口（`src/server/storage/index.ts`）：**校验 + key 生成 + 交给适配器**。
 *
 * 事实源：docs/api-contract.md §3（细则表）。
 *   - 类型白名单 `image/jpeg|png|webp`（按 `Content-Type` 判定）→ 否则 `INVALID_INPUT`(400)。
 *   - 单张 ≤5 MiB → 否则 `PAYLOAD_TOO_LARGE`(413)；**在读取字节前**先用 `size` 判定，
 *     免得为一张注定被拒的 50MB 文件分配内存。
 *   - `key = randomUUID() + 白名单扩展名`（**不取客户端文件名**）⇒ 落盘路径不可被影响。
 *   - 数量 ≤6 的约束发生在**发布**时（`CreateItemRequestSchema.imageKeys`），不在单次上传里。
 */
import { randomUUID } from 'node:crypto';

import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from '@/shared/schemas';
import type { UploadResult } from '@/shared/types';

import { errors } from '@/server/errors';
import { createRateLimiter } from '@/server/rate-limit';

import type { StorageAdapter } from './adapter';
import { LocalStorage } from './local';

/** `multipart/form-data` 里的 `file` 字段所需的最小形状（浏览器 `File` 天然满足）。 */
export interface UploadFileLike {
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

/** §3 上传限流：每用户 20 次/分、全局 200 次/分（进程内，口径同 §8）。 */
const uploadLimiter = createRateLimiter({
  windowMs: 60_000,
  userCapacity: 20,
  globalCapacity: 200,
});

/** 强制上传限流：超限抛 `RATE_LIMITED`(429)。 */
export function enforceUploadRateLimit(userId: string): void {
  uploadLimiter.enforce(userId);
}

/** 重置上传令牌桶（**测试专用**）。 */
export function resetUploadRateLimit(): void {
  uploadLimiter.reset();
}

/** 默认且唯一定稿实现；换对象存储只需改这一行。 */
export const storage: StorageAdapter = new LocalStorage();

/** MIME → 扩展名；不在白名单内抛 `INVALID_INPUT`。 */
export function extensionFor(contentType: string): string {
  const ext = ALLOWED_UPLOAD_MIME[contentType.toLowerCase()];
  if (!ext) {
    throw errors.invalidInput('仅支持 JPG / PNG / WebP 图片');
  }
  return ext;
}

/**
 * 校验并落盘一张图片。
 * @throws AppError INVALID_INPUT（类型不合法）| PAYLOAD_TOO_LARGE（>5 MiB）
 */
export async function putUpload(file: UploadFileLike): Promise<UploadResult> {
  const ext = extensionFor(file.type);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw errors.payloadTooLarge('单张图片不得超过 5MB');
  }
  if (file.size <= 0) {
    throw errors.invalidInput('图片内容为空');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return storage.put(`${randomUUID()}.${ext}`, bytes);
}
