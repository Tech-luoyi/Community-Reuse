/**
 * 社区成交数据版本指纹（`src/server/ai/fingerprint.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.5.3（**P0 红线先行项**）。
 *
 * **为什么存在**：定价缓存键原本只有 `sha256(kind + 规范化输入)`，而 `AiCache` 表**没有
 * `communityId` 列**。一旦定价开始消费本小区成交行情，`{name, description, category}` 相同的
 * 两个请求就会在**不同社区之间互相命中缓存**——A 小区拿到 B 小区行情推出的价格，且完全静默。
 * 故指纹必须先于工具落地。
 *
 * **为什么是 `(count, max(updatedAt))`**：`Item.updatedAt` 是 `@updatedAt` 列，任何改价 / 归档
 * 动作都会推进它；`count` 捕获集合增删。二者合并覆盖「插入 / 更新 / 删除」三类变更
 * ⇒ 数据变则指纹变 ⇒ 不会返回旧价。
 * 前提纪律见 §4.3② / §6.7.1 P5：`Item` 的写路径必须经 Prisma Client，raw `UPDATE` 不推进
 * `updatedAt` 会造成**指纹漏检**。
 *
 * **代价（有意接受）**：社区内任一条归档变动会使该社区**全部**定价缓存条目同时失效。
 * 取舍为「正确性 > 命中率」；发布 / 归档是低频动作。
 */
import { createHash } from 'node:crypto';

import { prisma } from '@/server/db';

/**
 * 定价缓存键的预映像命名空间。
 *
 * 与「纯单轮定价」**天然不可碰撞**：带工具的预映像含 `variant` + `commFp`，与旧预映像
 * 不同构，哈希空间不相交（§6.5.3）。因此**不新增 `AiKind` 枚举值**。
 */
export const PRICING_CACHE_VARIANT = 'PRICING_AGENT_V1';

interface FingerprintRow {
  count: number;
  maxUpdatedAt: Date | string | null;
}

/**
 * 计算某社区已成交（`ARCHIVED` 且含价格）集合的版本指纹。
 *
 * `communityId` 走 Prisma 标签模板参数绑定，**不做字符串拼接**；`status` 为字面量常量。
 *
 * @returns 十六进制 sha256；集合为空时返回「空集合指纹」（仍然稳定，且与非空集合不同）。
 */
export async function computeCommunityFingerprint(communityId: string): Promise<string> {
  const rows = await prisma.$queryRaw<FingerprintRow[]>`
    SELECT COUNT(*)::int AS "count", MAX("updatedAt") AS "maxUpdatedAt"
    FROM "Item"
    WHERE "communityId" = ${communityId}
      AND "status" = 'ARCHIVED'
      AND "price" IS NOT NULL
  `;
  const row: FingerprintRow = rows[0] ?? { count: 0, maxUpdatedAt: null };
  const stamp =
    row.maxUpdatedAt instanceof Date ? row.maxUpdatedAt.toISOString() : (row.maxUpdatedAt ?? '');
  return createHash('sha256').update(`${row.count}:${stamp}`).digest('hex');
}
