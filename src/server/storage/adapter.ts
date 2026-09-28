/**
 * 存储适配器**接口**（`src/server/storage/adapter.ts`）。
 *
 * 事实源：docs/tech-design-final.md §3「砍 MinIO → StorageAdapter + 默认 LocalStorage」/
 * docs/api-contract.md §3。定稿只做本地实现，保留接口形状即扩展点：
 * 将来接对象存储只需换一个实现类，调用点与契约都不用改。
 */
import type { UploadResult } from '@/shared/types';

export interface StorageAdapter {
  /** 实现名（`health.storage` 回显，如 `local`）。 */
  readonly name: string;
  /**
   * 落盘并由服务端生成好的 `key`，返回 `{ key, url }`。
   * `key` **只能由服务端构造**（见 `index.ts` 的 `putUpload`）：客户端文件名一律不采信。
   */
  put: (key: string, data: Uint8Array) => Promise<UploadResult>;
}
