-- ============================================================================
-- 邻里流转 · 迁移 0005：全量中文注释（11 张业务表 71 列 + 6 个枚举类型）
--
-- 【为什么是手写 raw SQL，而不是 schema.prisma 的 ///】
--   实测 Prisma 5.22.0：`prisma migrate diff --from-empty --to-schema-datamodel`
--   生成的全量 DDL 里 `COMMENT ON` 为 **0 条**。即 `///` 只进 Prisma Client 的
--   IDE 悬浮提示，**不会落到数据库**。要让 `\d+` / pgAdmin / DBeaver 里看得见中文
--   说明，只能显式写 COMMENT ON —— 这与 0003 里「vector 列 Prisma 读写不了」是
--   同一类事实：Prisma 的表达能力有边界，边界之外必须手写 SQL 并留下理由。
--
-- 【范围】
--   · 含：11 张 Prisma 管理的业务表（Community / CommunityMember / User / Item /
--     ItemImage / ItemEmbedding / ClaimRequest / Message / Favorite / Notification /
--     AiCache），共 71 列；6 个枚举类型。
--   · 不含：checkpoints / checkpoint_blobs / checkpoint_writes / checkpoint_migrations。
--     这 4 张由 LangGraph `PostgresSaver.setup()` 建（见 prisma/setup-checkpoint.ts），
--     属**第三方 DDL**，按 §10 的 DDL 归属纪律不由 Prisma 迁移管；给库自己管的对象
--     写死中文注释，等库升级改了结构就会变成误导。
--   · 不含：_prisma_migrations（Prisma 内部表）。
--
-- 【为什么枚举值没有逐条注释】
--   PostgreSQL **没有** `COMMENT ON ENUM VALUE` 语法（`pg_enum` 无 comment 列），
--   所以 23 个枚举值的语义写进各自类型注释里，而不是逐值建注释。
--
-- 【幂等性】
--   COMMENT ON 天然幂等（重复执行即覆盖为同值），与 0002 / 0004 显式声明的幂等
--   纪律一致。本迁移**不改任何结构、不新增索引、不升级锁**，可与在线读写并存。
-- ============================================================================

-- ============================ 枚举类型 ============================

COMMENT ON TYPE "ItemStatus" IS
  '物品状态机：ACTIVE=在架可领 → RESERVED=已接受某笔申请而预留 → ARCHIVED=下架归档；RESERVED 可回退 ACTIVE。列表主查询谓词为 (communityId, status=ACTIVE, publishedAt DESC)，与 Item 上的 @@index 完全匹配。';

COMMENT ON TYPE "TradeType" IS
  '交易方式（用枚举而非自由文本，便于筛选）：FREE=免费赠送 / PAY_WHATEVER=随便给 / FIXED_PRICE=标价（DB CHECK 强制此时 price 非空）/ OTHER=其他面议。';

COMMENT ON TYPE "ClaimStatus" IS
  '领取申请状态机：PENDING=待处理 → ACCEPTED=已被发布者接受 → COMPLETED=已完成交接；PENDING 亦可 → REJECTED=被拒 / CANCELED=申请者撤回。并发由两条部分唯一索引兜住：同物品同申请者至多一条 PENDING（迁移 0002）、同物品至多一条 ACCEPTED（迁移 0004）；历史的 REJECTED / CANCELED / COMPLETED 允许并存。';

COMMENT ON TYPE "NotificationType" IS
  '站内通知类型（D5：由裸 String 改 enum 以约束取值）：CLAIM_RECEIVED=收到申请 / CLAIM_ACCEPTED=申请被接受 / CLAIM_REJECTED=申请被拒 / CLAIM_COMPLETED=交接完成 / ITEM_RESERVED=物品被预留 / ITEM_ARCHIVED=物品被归档。治理模块下线后 ITEM_HIDDEN / REPORT_RESOLVED 已一并移除。';

COMMENT ON TYPE "MessageSenderType" IS
  '留言发送者类型：USER=真实成员发言 / AI=LLM 生成的回复建议（可一键发进留言板）。AI 消息无真实作者，故 Message.authorId 可空。';

COMMENT ON TYPE "AiKind" IS
  'LLM 能力类型：PRICING=智能定价建议 / POLISH=发布文案润色 / FAQ=留言板自动回复建议。同时是 AiCache 的分区维度（@@index([kind, createdAt])）。';

-- ============================ Community ============================

COMMENT ON TABLE "Community" IS
  '小区 —— 本系统的租户边界。物品、AI 缓存指纹、语义检索全部以 communityId 为过滤谓词。';

COMMENT ON COLUMN "Community"."id" IS '主键，cuid。';
COMMENT ON COLUMN "Community"."name" IS '小区名称，≤60 字符。';
COMMENT ON COLUMN "Community"."inviteCode" IS
  '加入本小区的唯一凭据，全局唯一。住户凭它自助加入（POST /api/auth/join）。不是秘密，但必须不可猜。';
COMMENT ON COLUMN "Community"."createdAt" IS '创建时间。';
COMMENT ON COLUMN "Community"."updatedAt" IS '最后更新时间，由 Prisma @updatedAt 维护。';

-- ============================ CommunityMember ============================

COMMENT ON TABLE "CommunityMember" IS
  '小区成员关系（User ↔ Community 多对多连接表）。@@unique([communityId, userId]) 保证不重复加入。';

COMMENT ON COLUMN "CommunityMember"."id" IS '主键，cuid。';
COMMENT ON COLUMN "CommunityMember"."communityId" IS '所属小区，外键 onDelete Cascade。';
COMMENT ON COLUMN "CommunityMember"."userId" IS '成员用户，外键 onDelete Cascade —— 删号即自动退出所有小区。';
COMMENT ON COLUMN "CommunityMember"."joinedAt" IS '加入时间。';

-- ============================ User ============================

COMMENT ON TABLE "User" IS
  '用户。无密码体系，身份由签名会话令牌承载。权限完全由关系推导：GUEST / MEMBER / OWNER(发布者) / ACCEPTED_APPLICANT —— 没有 role 列，因为治理模块下线后 MemberRole 成了死枚举，已移除。';

COMMENT ON COLUMN "User"."id" IS '主键，cuid。非秘密：会经 Message.author / ClaimRequest.applicant 以 {id, nickname} 形式对外暴露。';
COMMENT ON COLUMN "User"."nickname" IS '昵称，≤30 字符。';
COMMENT ON COLUMN "User"."contactText" IS
  '⚠️隐私关键列。联系方式的【单一事实源】（D1）。写入路径只有 PATCH /api/me（传空串等价于清空为 null）。物品详情接口**永不返回**本列；仅当存在一条 ACCEPTED / COMPLETED 的 ClaimRequest 时，才向该笔交易的对手方展示（见 api-contract.md §0.3 / §4）。';
COMMENT ON COLUMN "User"."createdAt" IS '注册时间。';
COMMENT ON COLUMN "User"."updatedAt" IS '最后更新时间，由 Prisma @updatedAt 维护。';

-- ============================ Item ============================

COMMENT ON TABLE "Item" IS
  '闲置物品 —— 业务主表。两条 DB 层 CHECK 约束（D3，Prisma 无法表达故落在迁移 0001）：price 非负；tradeType=FIXED_PRICE 时 price 必填。';

COMMENT ON COLUMN "Item"."id" IS '主键，cuid。';
COMMENT ON COLUMN "Item"."communityId" IS '所属小区 = 租户边界。列表、语义检索、成交统计的必备谓词，任何查询都不得省略。';
COMMENT ON COLUMN "Item"."ownerId" IS '发布者，外键 → User.id（无级联删除，物品保留归属痕迹）。';
COMMENT ON COLUMN "Item"."name" IS '物品名称，≤80 字符。';
COMMENT ON COLUMN "Item"."category" IS '分类，≤40 字符，可空。自由文本而非枚举 —— 分类由住户自行填写。';
COMMENT ON COLUMN "Item"."description" IS '描述，≤2000 字符，必填。';
COMMENT ON COLUMN "Item"."tradeType" IS '交易方式。CHECK 约束：取 FIXED_PRICE 时 price 必须非空。';
COMMENT ON COLUMN "Item"."price" IS '标价，numeric(10,2)，可空。CHECK 约束：非空时必须 >= 0。';
COMMENT ON COLUMN "Item"."status" IS '物品状态，默认 ACTIVE。状态迁移见 ItemStatus 类型注释。';
COMMENT ON COLUMN "Item"."publishedAt" IS '发布时间。默认列表按其 DESC 排序。';
COMMENT ON COLUMN "Item"."reservedAt" IS '进入 RESERVED 的时刻；NULL = 从未被预留过。';
COMMENT ON COLUMN "Item"."archivedAt" IS '进入 ARCHIVED 的时刻；NULL = 从未归档过。';
COMMENT ON COLUMN "Item"."createdAt" IS '记录创建时间。';
COMMENT ON COLUMN "Item"."updatedAt" IS '最后更新时间，由 Prisma @updatedAt 维护。';

-- ============================ ItemImage ============================

COMMENT ON TABLE "ItemImage" IS
  '物品图片。「≤6 张 / 类型白名单 / 单张 ≤5MiB」属【应用层】校验 —— 跨行计数约束无法用普通 CHECK 表达，故不在 DB 层。';

COMMENT ON COLUMN "ItemImage"."id" IS '主键，cuid。';
COMMENT ON COLUMN "ItemImage"."itemId" IS '所属物品，外键 onDelete Cascade —— 删物品即删图。';
COMMENT ON COLUMN "ItemImage"."url" IS
  'StorageAdapter 返回的访问路径（本地实现形如 /uploads/<key>；S3 实现为对象 URL）。注意：以 / 开头的 key 会被 toImageUrl 直通，故上游必须校验 key 不得为任意路径。';
COMMENT ON COLUMN "ItemImage"."sortOrder" IS '展示顺序，默认 0；首图即封面。@@index([itemId, sortOrder]) 支撑按序取图。';

-- ============================ ItemEmbedding ============================

COMMENT ON TABLE "ItemEmbedding" IS
  '语义检索语料（tech-design-final.md §6.5.9）。一行一件物品；删物品经 ON DELETE CASCADE 自动清理，不留孤儿向量。⚠️本表是全仓唯一必须用 raw SQL 读写的含时间戳表：embedding 是 pgvector 类型，Prisma 只能声明为 Unsupported，客户端**读不到也写不进**该列。唯一写入口是 src/server/ai/index-pipeline.ts。';

COMMENT ON COLUMN "ItemEmbedding"."itemId" IS '主键 = 物品 id（与 Item 一对一）。';
COMMENT ON COLUMN "ItemEmbedding"."communityId" IS
  '冗余自 Item，只作向量扫描的过滤前缀用。一致性**不靠 DB 约束** —— PG 的 CHECK 不能带子查询（实测报 0A000），故改靠「写端从 Item 读真值、读端同时联 Item 过滤」双保险，理由与验证位置见迁移 0003 头注。存在的唯一理由：让检索能先按社区过滤、再按距离排序（§6.5.6 第 6 条）。不接受调用方传入。';
COMMENT ON COLUMN "ItemEmbedding"."embedding" IS
  'vector(1024)，HNSW 索引 + vector_cosine_ops。维度写死在列宽里、不进运行时：换嵌入模型 = 一次新迁移 + 全量回填（迁移 0004 即为 1536→1024 的 bge-m3 切换）。若维度运行时可变，会出现「写入 1536、查询 1024」的静默错位。';
COMMENT ON COLUMN "ItemEmbedding"."contentHash" IS '语料规范化后的哈希；文本未变则跳过重算（§6.5.10 幂等）。';
COMMENT ON COLUMN "ItemEmbedding"."createdAt" IS '首次索引时间。';
COMMENT ON COLUMN "ItemEmbedding"."updatedAt" IS
  '最后重算时间。⚠️因写入绕开了 Prisma 的 @updatedAt，raw UPSERT 里必须显式写 now()。社区指纹把本列纳入 (count, max(updatedAt)) 聚合，所以「索引有没有推进」可被单测证伪。';

-- ============================ ClaimRequest ============================

COMMENT ON TABLE "ClaimRequest" IS
  '领取申请。状态迁移全部经 $transaction 收口，锁序恒为 Item → ClaimRequest，事务内不做外部 I/O。并发上限由两条部分唯一索引保证（见 ClaimStatus 类型注释）。';

COMMENT ON COLUMN "ClaimRequest"."id" IS '主键，cuid。';
COMMENT ON COLUMN "ClaimRequest"."itemId" IS '目标物品，外键 onDelete Cascade。';
COMMENT ON COLUMN "ClaimRequest"."applicantId" IS '申请者，外键 → User.id。';
COMMENT ON COLUMN "ClaimRequest"."message" IS '申请留言，≤500 字符，可空。';
COMMENT ON COLUMN "ClaimRequest"."preferredAt" IS '期望自提时间，可空。';
COMMENT ON COLUMN "ClaimRequest"."preferredLocation" IS '期望自提地点，≤120 字符，可空。';
COMMENT ON COLUMN "ClaimRequest"."status" IS '申请状态，默认 PENDING。状态机见 ClaimStatus 类型注释。';
COMMENT ON COLUMN "ClaimRequest"."createdAt" IS '申请时间。';
COMMENT ON COLUMN "ClaimRequest"."updatedAt" IS '最后更新时间，由 Prisma @updatedAt 维护。';
COMMENT ON COLUMN "ClaimRequest"."acceptedAt" IS '被接受的时刻；NULL = 尚未被接受。';
COMMENT ON COLUMN "ClaimRequest"."completedAt" IS '交接完成的时刻；NULL = 尚未完成。';

-- ============================ Message ============================

COMMENT ON TABLE "Message" IS
  '物品留言板。@@index([itemId, createdAt]) 支撑按时间正序取留言。';

COMMENT ON COLUMN "Message"."id" IS '主键，cuid。';
COMMENT ON COLUMN "Message"."itemId" IS '所属物品，外键 onDelete Cascade。';
COMMENT ON COLUMN "Message"."authorId" IS
  '作者，**可空** —— AI 生成的消息（senderType=AI）无真实作者。外键 onDelete SetNull：作者删号后留言保留、作者置空，而不是连带删掉整条对话。';
COMMENT ON COLUMN "Message"."senderType" IS '发送者类型，默认 USER。USER=成员发言 / AI=模型生成的回复建议。';
COMMENT ON COLUMN "Message"."content" IS '正文，≤1000 字符。';
COMMENT ON COLUMN "Message"."createdAt" IS '发言时间。';

-- ============================ Favorite ============================

COMMENT ON TABLE "Favorite" IS
  '收藏（User ↔ Item）。@@unique([userId, itemId]) 保证同一人不会重复收藏同一件物品。';

COMMENT ON COLUMN "Favorite"."id" IS '主键，cuid。';
COMMENT ON COLUMN "Favorite"."userId" IS '收藏者，外键 onDelete Cascade。';
COMMENT ON COLUMN "Favorite"."itemId" IS '被收藏物品，外键 onDelete Cascade。';
COMMENT ON COLUMN "Favorite"."createdAt" IS
  '收藏时间。两个索引服务两条不同查询：@@index([userId, createdAt]) 供收藏夹列表；@@index([itemId]) 供列表页 favorite_count 子查询（迁移 0004 补，此前该子查询按 itemId 过滤却无打头索引，每页都要全表扫页大小次）。';

-- ============================ Notification ============================

COMMENT ON TABLE "Notification" IS
  '站内通知。@@index([userId, readAt, createdAt]) 同时支撑未读计数与列表分页。';

COMMENT ON COLUMN "Notification"."id" IS '主键，cuid。';
COMMENT ON COLUMN "Notification"."userId" IS '接收者，外键 onDelete Cascade。';
COMMENT ON COLUMN "Notification"."type" IS '通知类型，见 NotificationType 类型注释。';
COMMENT ON COLUMN "Notification"."title" IS '标题，≤80 字符。落库时已渲染好，不由前端拼接。';
COMMENT ON COLUMN "Notification"."content" IS '正文，≤500 字符。同上，服务端渲染。';
COMMENT ON COLUMN "Notification"."readAt" IS 'NULL = 未读；非 NULL = 已读时刻。批量已读即把 NULL 批量置为 now()。';
COMMENT ON COLUMN "Notification"."createdAt" IS '产生时间。';

-- ============================ AiCache ============================

COMMENT ON TABLE "AiCache" IS
  'LLM 结果缓存的 L2（L1 是进程内 LRU），按输入指纹去重。⚠️已知缺口：无 TTL / 过期列，也没有清理任务，表只增不减 —— 当前体量极小，属「知道会胀、还没胀」，扩容前需补过期列或定期清理。';

COMMENT ON COLUMN "AiCache"."id" IS '主键，cuid。';
COMMENT ON COLUMN "AiCache"."inputHash" IS
  'sha256(variant + kind + input + commFp)，全局唯一。⚠️含**社区指纹** commFp =（该社区物品的 count, max(updatedAt)）聚合，因此跨租户不可能命中同一条缓存；社区数据一推进，指纹即变，旧缓存自然失效（无需显式失效逻辑）。';
COMMENT ON COLUMN "AiCache"."kind" IS '能力类型，见 AiKind 类型注释。';
COMMENT ON COLUMN "AiCache"."outputJson" IS '契约体原文（text）。内嵌 variant 与 commFp，便于排查「这条缓存是谁在什么语料下算出来的」。';
COMMENT ON COLUMN "AiCache"."createdAt" IS '写入时间。@@index([kind, createdAt]) 供按能力维度做观测与将来的清理。';
