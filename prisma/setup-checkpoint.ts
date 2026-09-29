/**
 * 建 LangGraph checkpoint 表（一次性 DDL 脚本）。
 *
 * 用法：`npm run ai:setup-checkpoint`
 *      （等价于 `tsx --env-file-if-exists=.env prisma/setup-checkpoint.ts`）
 *
 * ⚠️ **`--env-file-if-exists` 不是可有可无的**：本脚本在碰过 `@prisma/client` **之前**
 * 就要读 `process.env.DATABASE_URL`。`tsx prisma/setup-checkpoint.ts` 会静默拿到 undefined，
 * 于是报「DATABASE_URL 未配置」——而 `db:seed` 之所以能裸跑，是因为 Prisma Client 自己
 * 会加载 `.env`，本脚本没有那个副作用。这个差别只在 CLI 入口暴露，vitest 下测不出来
 * （测试环境已载入 env），所以曾经真的坏过一次。
 *
 * **为什么单独成脚本、不在请求路径上**：`PostgresSaver.setup()` 会 CREATE TABLE /
 * CREATE TYPE。放在请求里等于每个定价请求都可能抢一次 DDL 锁，既慢又会在并发下互相阻塞。
 * 与 `prisma/seed.ts` 同一类「运维脚本」定位。
 *
 * **为什么这些表不进 `prisma/schema.prisma`**：Prisma 与 LangGraph 会抢同一批 DDL——
 * `prisma migrate` 看到库里有意外的表会生成 DROP。替代做法是把它们声明为「外部管理表」，
 * 并由 `tests/unit/data-layer-invariants.test.ts` 守住「Prisma 不拥有这些表」这一事实。
 */
import { closeCheckpointer, setupCheckpointer } from '@/server/ai/checkpoint';

async function main(): Promise<void> {
  const ok = await setupCheckpointer();
  if (!ok) {
    console.error(
      '[setup-checkpoint] DATABASE_URL 未配置或不可解析，无法建 checkpoint 表。' +
        ' 提示：`cp .env.example .env` 并填好 DATABASE_URL。',
    );
    process.exitCode = 1;
    return;
  }
  console.log('[setup-checkpoint] checkpoint 表已就绪（幂等，可重复执行）。');
  console.log(
    '[setup-checkpoint] 注意：这些表由 LangGraph 管理，**不要**加入 prisma/schema.prisma。',
  );
}

// 不用 top-level await：tsx 在 CJS 输出下会拒绝（与 prisma/seed.ts 同样的收尾写法）。
void main()
  .catch((error: unknown) => {
    console.error('[setup-checkpoint] 失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeCheckpointer();
  });
