/**
 * 语义向量全量回填（`prisma/embed-backfill.ts`）。
 *
 * 用法：`npm run db:embed`
 *      （= `tsx --env-file-if-exists=.env prisma/embed-backfill.ts`；
 *        `--env-file-if-exists` 的原因与 `setup-checkpoint.ts` 同一个坑，见该文件头注）
 *
 * 三个使用场景（§6.5.10）：首次上线、换 embedding 模型（配合新迁移）、索引管道
 * 因嵌入服务不可达而漏建之后的补偿。
 *
 * **为什么需要独立脚本而不只靠管道钩子**：钩子是「事务后异步、失败只记日志」，
 * 这正确地把可用性优先级放在「不阻断发布」上，代价就是**会静默漏建**。
 * 漏了必须有一条能重跑、且重跑便宜（靠 `contentHash` 幂等）的补偿路径。
 *
 * 退出码：未配置嵌入供应商 ⇒ 1（否则会把「一条都没建」伪装成「建完了」）。
 */
import { getEmbeddingConfig, openAiCompatibleEmbeddings } from '@/server/ai/embeddings';
import { indexItem } from '@/server/ai/index-pipeline';
import { prisma } from '@/server/db';

interface Candidate {
  id: string;
  name: string;
  description: string;
  category: string | null;
}

async function main(): Promise<void> {
  if (getEmbeddingConfig() === null) {
    console.error(
      '[db:embed] 未配置 EMBEDDING_API_KEY / EMBEDDING_BASE_URL，无法回填。\n' +
        '  语义检索是可选增强：不配也能跑定价 agent（聚合工具不依赖它）。\n' +
        '  要启用请在 .env 里补 EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL / EMBEDDING_DIM，\n' +
        '  并确认 EMBEDDING_DIM 与迁移里的 vector(<DIM>) 列宽一致。',
    );
    process.exitCode = 1;
    return;
  }

  // 只处理**有描述**的物品：空文本嵌入出来的向量近似零向量，检索时全是噪声。
  const items = (await prisma.item.findMany({
    where: { description: { not: '' } },
    select: { id: true, name: true, description: true, category: true },
    orderBy: { publishedAt: 'desc' },
  })) as Candidate[];

  console.log(`[db:embed] 候选物品 ${items.length} 件`);

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    const outcome = await indexItem(item, openAiCompatibleEmbeddings);
    if (outcome.status === 'indexed') {
      indexed += 1;
    } else if (outcome.status === 'skipped') {
      skipped += 1;
    } else {
      failed += 1;
      console.warn(`[db:embed] 失败 ${item.id}: ${outcome.reason}`);
    }
  }

  console.log(
    `[db:embed] 完成：新建/更新 ${indexed}，跳过（未变/无社区） ${skipped}，失败 ${failed}`,
  );
  if (failed > 0) {
    // 有失败就不算成功：让 CI / 运维能感知到需要重跑，而不是静默留下半成品语料。
    process.exitCode = 1;
  }
}

void main()
  .catch((error: unknown) => {
    console.error('[db:embed] 异常终止：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
