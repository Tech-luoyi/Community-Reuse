/**
 * 语义索引管道（`src/server/ai/index-pipeline.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.5.10。
 *
 * **本表是全仓唯一走 raw SQL 写入的含时间戳表**，原因写在迁移 0003 的头注里：
 * pgvector 的 `vector` 类型在 Prisma 只能声明为 `Unsupported`，客户端**读不到也写不进**
 * 该列。所以 §4.3②「含 `@default(now())` / `@updatedAt` 的表必须经 Prisma Client」这条
 * 纪律在这里**无法照字面执行**，替代纪律是：
 *   ① 本模块是该表**唯一**的写入口；
 *   ② raw UPSERT 里**显式** `"updatedAt" = now()`（§6.7.1 P5 对 raw 写入的既有要求）；
 *   ③ 社区数据指纹（§6.5.3）已把本表 `(count, max("updatedAt"))` 纳入预映像，
 *      所以「updatedAt 有没有被推进」是可被证伪的，不靠自觉；
 *   ④ 冗余的 `communityId` **不接受调用方传入**，由本模块按 itemId 从 Item 读真值
 *      ——跨表 CHECK 在 PG 里写不出来（实测 0A000，见迁移 0003 头注），那就让分叉无从被写入。
 *
 * **绝不阻断主流程**：向量是增强项。发布 / 归档物品不该因为 embedding 服务挂掉而失败，
 * 所以本模块所有失败都只记日志、返回状态码，**不抛异常**给调用方。
 */
import type { EmbeddingProvider } from './embeddings';
import { contentHash, itemCorpusText } from './embeddings';
import { prisma } from '@/server/db';
import { log } from '@/server/logger';

/** 单件物品的索引结果，供调用方记日志与回填脚本统计。 */
export type IndexOutcome =
  | { status: 'indexed' }
  | { status: 'skipped'; why: 'unchanged' | 'embedding-unconfigured' }
  | { status: 'failed'; reason: string };

interface ExistingRow {
  contentHash: string;
}

/** 读已存的语料哈希（判断是否需要重算）。表不存在时返回 null（首次上线前的正常状态）。 */
async function existingHash(itemId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<ExistingRow[]>`
      SELECT "contentHash" FROM "ItemEmbedding" WHERE "itemId" = ${itemId}
    `;
    return rows[0]?.contentHash ?? null;
  } catch {
    return null;
  }
}

/**
 * 物品真实所属社区；不存在则 null。
 *
 * 为什么由本模块去读、而不是让调用方把 `communityId` 传进来：
 * `ItemEmbedding.communityId` 是冗余列，PG 的 CHECK 又不允许跨表子查询（实测 0A000），
 * 所以数据库层没有东西能拦住「写错的社区」。让**唯一写入口**自己按 itemId 取真值，
 * 就把「冗余列与 Item 不一致」从「需要检测的坏状态」变成了「无法被写入的状态」。
 */
async function resolveCommunityId(itemId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ communityId: string }[]>`
    SELECT "communityId" FROM "Item" WHERE "id" = ${itemId}
  `;
  return rows[0]?.communityId ?? null;
}

/** 送去嵌入时需要的字段。**刻意不含 communityId**：它由本模块自己按 id 读，见上。 */
export interface IndexableItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}

/**
 * 为单件物品建立 / 更新语义向量。
 */
export async function indexItem(
  item: IndexableItem,
  provider: EmbeddingProvider | null,
): Promise<IndexOutcome> {
  if (provider === null) {
    return { status: 'skipped', why: 'embedding-unconfigured' };
  }
  const text = itemCorpusText(item);
  const hash = contentHash(text);
  if ((await existingHash(item.id)) === hash) {
    return { status: 'skipped', why: 'unchanged' };
  }

  // 放在 embed 之前：物品不存在时省掉一次白花花的嵌入调用。
  const communityId = await resolveCommunityId(item.id);
  if (communityId === null) {
    return { status: 'failed', reason: '物品不存在，无法确定社区' };
  }

  try {
    const [vector] = await provider.embed([text]);
    if (vector === undefined || vector.length === 0) {
      return { status: 'failed', reason: '空向量' };
    }
    // 非有限值归零，随后作为**绑定参数**下发、在 SQL 侧 cast 成 vector——不拼 SQL 字符串。
    const literal = `[${vector.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
    await prisma.$executeRaw`
      INSERT INTO "ItemEmbedding"
        ("itemId", "communityId", "embedding", "contentHash", "createdAt", "updatedAt")
      VALUES
        (${item.id}, ${communityId}, ${literal}::vector, ${hash}, now(), now())
      ON CONFLICT ("itemId") DO UPDATE SET
        "communityId" = EXCLUDED."communityId",
        "embedding"   = EXCLUDED."embedding",
        "contentHash" = EXCLUDED."contentHash",
        -- 显式推进：这是替代纪律 ②，缺了它 §6.5.3 的指纹就会漏检、旧定价缓存不会失效。
        "updatedAt"   = now()
    `;
    return { status: 'indexed' };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    };
  }
}

/** 删除物品的向量（归档不必删——归档物品正是价格锚点来源；仅物品被真删时级联，这里提供显式入口）。 */
export async function unindexItem(itemId: string): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM "ItemEmbedding" WHERE "itemId" = ${itemId}`;
  } catch {
    // 表不存在或删除失败都不影响主流程。
  }
}

/**
 * 事务提交后的挂钩：供 items service 在 create / update / archive 之后调用。
 *
 * 刻意 **fire-and-forget**：调用方 `void indexAfterCommit(...)`，不 await、不抛。
 * 失败只打一行日志——发布接口的成败不该由 embedding 服务决定。
 */
export function indexAfterCommit(item: IndexableItem, provider: EmbeddingProvider | null): void {
  void indexItem(item, provider).then((outcome) => {
    if (outcome.status === 'failed') {
      log.warn('[ai.index] 语义索引失败（不影响主流程）', {
        itemId: item.id,
        reason: outcome.reason,
      });
    }
  });
}
