-- ============================================================================
-- 邻里流转 · 迁移 0005：11 张业务表的中文表注释
--
-- 为什么手写 SQL：实测 Prisma 5.22.0 不把 schema 的 /// 落成数据库注释
-- （migrate diff --from-empty 生成的 DDL 里 COMMENT ON 为 0 条），/// 只进
-- Prisma Client 的 IDE 提示。要让 \d+ / pgAdmin 里看得见说明，只能显式写。
--
-- 范围：11 张 Prisma 管理的业务表，只写表级用途。
-- 不含：4 张 LangGraph checkpoint 表（PostgresSaver.setup() 建的第三方 DDL，
--       按 §10 归属纪律不由 Prisma 迁移管）、_prisma_migrations（Prisma 内部表）。
--
-- 幂等：COMMENT ON 重复执行即覆盖。不改结构、不加索引、不升级锁。
-- ============================================================================

COMMENT ON TABLE "Community" IS '小区 —— 本系统的租户边界，物品/缓存指纹/语义检索都以它为过滤维度。';

COMMENT ON TABLE "CommunityMember" IS '小区成员关系（User ↔ Community 多对多）。';

COMMENT ON TABLE "User" IS '用户。无密码体系，权限由关系推导，故没有 role 列。';

COMMENT ON TABLE "Item" IS '闲置物品 —— 业务主表。';

COMMENT ON TABLE "ItemImage" IS '物品图片，sortOrder 最小者为封面。';

COMMENT ON TABLE "ItemEmbedding" IS '语义检索向量语料，一行一件物品。pgvector 列 Prisma 读写不了，只能走 raw SQL。';

COMMENT ON TABLE "ClaimRequest" IS '领取申请。';

COMMENT ON TABLE "Message" IS '物品留言板，含成员发言与 AI 生成的回复建议。';

COMMENT ON TABLE "Favorite" IS '收藏（User ↔ Item）。';

COMMENT ON TABLE "Notification" IS '站内通知。';

COMMENT ON TABLE "AiCache" IS 'LLM 结果缓存的 L2（L1 是进程内 LRU），按输入指纹去重。';
