-- ============================================================================
-- 邻里流转 · 迁移 0003：pgvector 扩展 + ItemEmbedding 语义检索语料表
--
-- 设计来源：docs/tech-design-final.md §6.5.9（嵌入模型、维度与供应商抽象）、
--           §6.5.10（索引管道）、§6.5.6 第 6 条（向量检索的租户谓词）。
--
-- 为什么手写：与 0001 / 0002 同源——沙箱内 Prisma CLI 会被 SIGKILL，无法用
-- `prisma migrate dev` 生成；具备 Docker 的环境用 `npx prisma migrate deploy` 应用。
--
-- 为什么必须 `CREATE EXTENSION`：`postgres:16-alpine` **不含** pgvector
--   （实测 `CREATE EXTENSION vector` → `ERROR: extension "vector" is not available`，
--    该镜像只带 `pg_trgm`）。故 docker-compose.yml 改用 docker/db.Dockerfile 构建的镜像。
--   ⚠️ 换镜像时 `TZ: UTC` 必须原样保留（§4.3② 时钟源不变量），否则 `ageHours`
--   会随宿主时区静默偏移，新鲜度标签全线出错。
--
-- 【与 §4.3② 写路径纪律的一处必要偏离，务必读这段】
--   §4.3② / §6.7.1 P5 规定：含 `@default(now())` / `@updatedAt` 的表，写路径必须经
--   Prisma Client。但 `vector` 在 Prisma 里只能声明为 `Unsupported("vector(1536)")`，
--   **客户端会完全忽略该列**——既不能 create 也不能 select。因此 ItemEmbedding 的写入
--   **只能走 $executeRaw**。
--   替代纪律（不是放松，是换一种执行方式）：
--     ① 本表唯一的写路径是 src/server/ai/index-pipeline.ts，raw SQL 里
--        **显式赋值 "updatedAt" = now()**（§6.7.1 P5 对 raw INSERT 的既有要求）；
--     ② 社区数据指纹（§6.5.3）把本表的 (count, max("updatedAt")) 纳入预映像，
--        所以「updatedAt 有没有被推进」是可被单测证伪的，不靠自觉；
--     ③ 禁止任何其他模块对本表做 raw UPDATE。
--
-- 为什么维度写死在列宽里、不做成运行时可变：
--   若列宽随 `EMBEDDING_DIM` 变化，换一次 embedding 模型就会得到「列宽 1536、
--   查询用 1024 维向量算距离」——**不报错，只是召回悄悄变差**。显式失败好过静默错位，
--   所以换模型的代价被设计成「一次新迁移 + 全量回填」，而不是「改个环境变量」。
--   运行期 embeddings.ts 仍会逐条校验返回长度 === 配置维度，不符即抛错。
--
-- 为什么 communityId 要冗余一份（Item 表上已有）：
--   §6.5.6 第 6 条要求向量检索**先按社区过滤、再按距离排序**。若靠 JOIN Item 拿社区，
--   规划器可能先做全局 top-k 再过滤，导致别的社区物品进入候选集并在截断处造成偏置。
--   冗余一列 + 独立索引，把租户谓词钉在向量扫描之前。
--
-- 为什么用 HNSW 而非 IVFFlat：
--   本场景语料极小（种子仅 8 件），HNSW 建索引无需先灌数据、召回稳定；
--   IVFFlat 要求先有数据再训练 lists，小集合上反而更容易退化。
--   ⚠️ 小语料下 HNSW 可能因成本估算被规划器弃用而走顺序扫描——这**不影响正确性**
--   （谓词仍在，顺序扫描同样带租户过滤），只影响性能；故不在此强制。
--
-- 为什么「冗余列与 Item 一致」这条不变量**不**用数据库约束来保证：
--   第一版这里写的是
--     CHECK ("communityId" = (SELECT "communityId" FROM "Item" WHERE "Item"."id" = "ItemEmbedding"."itemId"))
--   真跑 `prisma migrate deploy` 直接报 `SQLSTATE 0A000: cannot use subquery in check constraint`
--   ——PostgreSQL 从来不允许 CHECK 里有子查询，是设计文档写错了，不是环境不支持。
--   替代方案里唯一"声明式"的是把外键指向 (id, communityId) 这一对，但那要在 **Item** 上加
--   一条 UNIQUE(id, communityId)、并在本表加 @@unique([itemId, communityId])（Prisma 要求
--   复合 1:1 的两侧都唯一）——两条纯粹为满足约束表达而存在的空索引，代价落在热表上。
--   改成从两端把「不一致」变成**不可能发生**，而不是事后检测：
--     · 读端：retrieve.ts 的 CTE 同时带 `e."communityId" = ?` **和** `i."communityId" = ?`，
--       所以即便冗余列被写坏，联表谓词也会把他人社区滤掉——泄漏不可能；
--     · 写端：index-pipeline 不再接受调用方传入的 communityId，而是自己按 itemId 从 Item 读，
--       于是冗余列**只可能是真值的副本**——分叉不可能被写入。
--   两端都不可发生时，约束只剩"防未来某个绕过这两个模块的写者"，而那条防线交给
--   tests/integration/retrieve-tenant.test.ts 的行为断言更划算。
--
-- 幂等性：`CREATE EXTENSION IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS`，
--   与 0001 的 `IF NOT EXISTS` 风格一致，便于 `migrate deploy` 重放。
--   ⚠️ 整份文件由 `migrate deploy` 放在**单个事务**里执行，实测失败即全回滚
--   （扩展不会留下半个），所以不必为「半应用」写补偿。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "ItemEmbedding" (
    "itemId"      TEXT          NOT NULL,
    "communityId" TEXT          NOT NULL,
    "embedding"   vector(1536)  NOT NULL,
    -- 语料规范化后的哈希；用于「文本没变就不重算嵌入」的幂等判断（§6.5.10）。
    "contentHash" TEXT          NOT NULL,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 非 @default(now()) 一条纪律：raw INSERT 必须自带（§6.7.1 P5）。
    "updatedAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemEmbedding_pkey" PRIMARY KEY ("itemId"),
    -- 物品被真删时不留孤儿向量；itemId 不存在则整行被拒（写端因此无法给不存在的物品建索引）。
    CONSTRAINT "ItemEmbedding_itemId_fkey"
        FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 租户谓词索引：让 WHERE "communityId" = ? 先于向量距离计算生效。
CREATE INDEX IF NOT EXISTS "ItemEmbedding_communityId_idx"
    ON "ItemEmbedding" ("communityId");

-- 向量近邻索引（余弦距离；与检索 SQL 的 `<=>` 运算符一致）。
CREATE INDEX IF NOT EXISTS "ItemEmbedding_embedding_hnsw_idx"
    ON "ItemEmbedding" USING hnsw ("embedding" vector_cosine_ops);
