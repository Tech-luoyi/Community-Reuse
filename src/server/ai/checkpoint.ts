/**
 * 多轮会话记忆（`src/server/ai/checkpoint.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.4（INC-2 范围第 ③ 项）、§9 T14。
 *
 * 用 LangGraph 的 `PostgresSaver` 把图的 state 落到 PostgreSQL，使同一 thread 的后续请求
 * 能看到此前几轮的对话与取证结果。
 *
 * **三条纪律**：
 *
 * 1. **thread key 只能由服务端从会话派生**（见 `pricingThreadKey`）。绝不可让客户端传
 *    自由文本的 threadId——那等于把「谁能读到谁的对话」交给请求体，是与缓存指纹同一类
 *    跨租户泄漏，只是换了载体。
 *
 * 2. **DDL 不在请求路径上**。`PostgresSaver.setup()` 建表，只在
 *    `npm run ai:setup-checkpoint` 里调用。否则每个请求都可能尝试建表，既慢又会在并发下
 *    抢 DDL 锁。
 *
 * 3. **记忆不可用绝不能让接口失败**。checkpoint 表没建、连接失败 ⇒ 返回 `null`，
 *    图退化为「无记忆单次调用」，`source` 与 `degraded` 语义完全不变。理由同 §6.5.7 F4：
 *    增强项挂了不许把主路径拖下水。
 *
 * **checkpoint 表的 DDL 归属**：这些表**不进** `prisma/schema.prisma`——Prisma 与
 * LangGraph 会抢同一批 DDL。做法是在 §10 里显式声明为「外部管理表」，并由
 * `tests/unit/data-layer-invariants.test.ts` 断言 `prisma migrate` 不会把它们「纠正」掉。
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/** 记忆不可用时抛给上层的信号（内部使用，不外泄到响应）。 */
type Checkpointer = PostgresSaver;

let cached: Checkpointer | null | undefined;

/**
 * 从 `DATABASE_URL` 构造 checkpointer 的连接串。
 *
 * 导出是为了单独测「Prisma 专用查询参数会弄坏 node-postgres」这一条——它是个很容易
 * 被忽略、又只会在运行时炸的坑。
 */
export function checkpointConnectionString(): string | null {
  const raw = process.env.DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  try {
    const url = new URL(raw);
    // Prisma 用 `?schema=public` 指定 search_path；node-postgres 不认这个参数。
    url.searchParams.delete('schema');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 取得进程内单例 checkpointer。
 * @returns 未配置或构造失败时 `null` —— 调用方据此走「无记忆」路径。
 */
export function getCheckpointer(): Checkpointer | null {
  if (cached !== undefined) {
    return cached;
  }
  const dsn = checkpointConnectionString();
  if (dsn === null) {
    cached = null;
    return cached;
  }
  try {
    cached = PostgresSaver.fromConnString(dsn);
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * 建表（幂等）。仅供 `npm run ai:setup-checkpoint` 调用，**不要在请求路径上调**。
 *
 * @returns 是否成功；`false` 表示未配置连接串。
 */
export async function setupCheckpointer(): Promise<boolean> {
  const saver = getCheckpointer();
  if (saver === null) {
    return false;
  }
  await saver.setup();
  return true;
}

/**
 * 释放连接池（脚本与测试收尾用）。
 *
 * 该版本的 `PostgresSaver` **没有** `close()`——它把连接池挂在 `.pool`（node-postgres
 * `Pool`）上，所以收尾是 `pool.end()`。这里做了结构化的窄化，避免把不存在的 API 写进代码。
 */
export async function closeCheckpointer(): Promise<void> {
  const saver = cached;
  cached = undefined;
  if (saver === null || saver === undefined) {
    return;
  }
  const pool = (saver as unknown as { pool?: { end?: () => Promise<unknown> } }).pool;
  try {
    await pool?.end?.();
  } catch {
    // 收尾失败不影响任何主流程。
  }
}

/**
 * 定价对话的 thread key：**服务端派生，含租户与用户两个维度**。
 *
 * 为什么两个维度都要：只按 userId 分会让同一用户在 A 社区的定价结论被带进 B 社区的
 * 对话里——而定价依据的是**本小区成交行情**，跨社区引用等于把上一个社区的锚点当成本
 * 社区的现实。
 */
export function pricingThreadKey(userId: string, communityId: string): string {
  return `pricing:${communityId}:${userId}`;
}

/** 仅供测试：重置进程内单例。 */
export function resetCheckpointerForTest(): void {
  cached = undefined;
}
