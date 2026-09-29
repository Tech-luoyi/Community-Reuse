-- ============================================================================
-- 0004：`ItemEmbedding.embedding` 列宽 1536 → 1024（嵌入模型换 bge-m3）
--
-- 为什么这次是「换列宽」而不是「换 env」：维度是**建表时**钉死的（0003 的设计纪律，
-- 见那里的注释），运行期的 `EMBEDDING_DIM` 不参与建表。所以换嵌入模型必然是一次
-- 显式施工，而不是改一个环境变量——这条纪律的价值就在这里：静默错位不可能发生。
-- 1024 远低于 pgvector 的索引维度上限（HNSW/IVFFlat ≤ 2000），建索引无碍。
--
-- 为什么不用 `ALTER COLUMN ... TYPE`：pgvector 不提供 1536 → 1024 的截断 cast，
-- `USING "embedding"::vector(1024)` 在有行时必然失败。这里走「删列 + 重建」。
--
-- 为什么先 DELETE 整表：不同模型的向量**不在同一个语义空间**里，混着放等于让
-- 近邻检索算出没有意义的距离。换模型之后旧向量一律失效，正确动作是删掉再全量重算
-- （`npm run db:embed`），不是想办法保住它们。这也让本迁移在非空库上可重放：
-- 否则 `ADD COLUMN ... NOT NULL`（无默认值）在有行时会直接失败。
--
-- 换模型的三件配套事，缺一即静默失败：
--   ① 本迁移改列宽；② `.env` 的 `EMBEDDING_DIM=1024`（`embeddings.ts` 会按它硬校验
--      返回向量长度，不符就抛 `EmbeddingUnavailableError`）；③ `npm run db:embed` 全量重算。
--
-- 幂等性：与 0001/0003 同风格。⚠️ 整份文件由 `migrate deploy` 放在**单个事务**里执行，
--   实测失败即全回滚，不必为「半应用」写补偿。
-- ============================================================================

DELETE FROM "ItemEmbedding";

-- 依赖列的索引先显式摘掉：DROP COLUMN 会自动级联删索引，这里写出来是为了让
-- 「索引宽度跟着列宽走」这件事在文件里可见，而不是靠 PG 的隐式行为。
DROP INDEX IF EXISTS "ItemEmbedding_embedding_hnsw_idx";

ALTER TABLE "ItemEmbedding" DROP COLUMN "embedding";

ALTER TABLE "ItemEmbedding" ADD COLUMN "embedding" vector(1024) NOT NULL;

-- 向量近邻索引（余弦距离；与检索 SQL 的 `<=>` 运算符一致）。
CREATE INDEX IF NOT EXISTS "ItemEmbedding_embedding_hnsw_idx"
    ON "ItemEmbedding" USING hnsw ("embedding" vector_cosine_ops);
