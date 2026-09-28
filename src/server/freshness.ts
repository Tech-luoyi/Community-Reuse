/**
 * 新鲜度分桶（**纯函数**）。
 *
 * 事实源：docs/tech-design-final.md §4.3①（Q1/Q2/Q4 裁决）。
 * 设计铁律：本模块**不读时钟**——签名只吃 `ageHours`，内部**禁止**出现 `Date.now()` / `new Date()`。
 *   `ageHours` 由 SQL 用 DB `now()` 计算（见 src/server/items/sql.ts），应用时钟与 DB 时钟不混用。
 *
 * 分桶为**半开区间**（Q1 写死）：
 *   [0, 24)  → JUST_LISTED「刚上架」
 *   [24, 72) → NEW「新上架」
 *   [72, ∞)  → OLDER「已上架 N 天」
 * 即 24.00 → NEW、72.00 → OLDER。
 */
import type { FreshnessCode } from '@/shared/types';

export interface FreshnessBucket {
  code: FreshnessCode;
  label: string;
}

/**
 * 按已上架小时数分桶。
 * @param ageHours 已上架小时数（**非负**；SQL 侧已 `GREATEST(0, …)` 夹取，未来值落 0 档）
 */
export function bucketFreshness(ageHours: number): FreshnessBucket {
  if (ageHours < 24) {
    return { code: 'JUST_LISTED', label: '刚上架' };
  }
  if (ageHours < 72) {
    return { code: 'NEW', label: '新上架' };
  }
  return { code: 'OLDER', label: `已上架 ${Math.floor(ageHours / 24)} 天` };
}
