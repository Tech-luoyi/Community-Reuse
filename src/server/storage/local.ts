/**
 * 本地磁盘存储实现（`src/server/storage/local.ts`）——定稿**唯一**实现。
 *
 * 事实源：docs/api-contract.md §3。写 `UPLOAD_DIR`（默认 `./public/uploads`），
 * URL 恒为 `/uploads/<key>`，由 Next.js 静态托管该目录直接可访问。
 *
 * 路径安全：`key` 由 `index.ts` 用 `randomUUID() + 白名单扩展名` 构造，
 * **不含**任何用户可控片段 ⇒ 此处无需再做穿越过滤（客户端文件名一律不采信）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { StorageAdapter } from './adapter';

/** 本地目录 → 对外 URL 前缀（与 `public/uploads` 的静态挂载点一致）。 */
export const UPLOAD_URL_PREFIX = '/uploads';

/** 默认落盘目录（`.env.example` 的 `UPLOAD_DIR` 口径）。 */
export const DEFAULT_UPLOAD_DIR = './public/uploads';

/** 解析 `UPLOAD_DIR`：相对路径按进程工作目录（项目根）展开。 */
export function resolveUploadDir(value?: string): string {
  const raw = value ?? process.env.UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR;
  return path.resolve(process.cwd(), raw);
}

export class LocalStorage implements StorageAdapter {
  public readonly name = 'local';

  public async put(key: string, data: Uint8Array): Promise<{ key: string; url: string }> {
    const dir = resolveUploadDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, key), data);
    return { key, url: `${UPLOAD_URL_PREFIX}/${key}` };
  }
}
