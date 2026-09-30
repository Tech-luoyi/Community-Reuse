# 治理模块恢复（管理员隐藏 + 简化举报）· 设计

日期：2026-09-30 · 范围：仅后端 · 状态：待用户复核

---

## 1. 这是一次决策反转，不是填空白

原设计在 **2026-09-28 由客户确认砍掉**「举报 + 管理员隐藏」，连带移除 `Report` / `ReportStatus` / `MemberRole` / `Item.hiddenAt` / `CommunityMember.role` / `User.reports` / `/api/admin/**`，`NotificationType` 由 8 值降至 6 值。理由记录在 `docs/tech-design-final.md:1371`：**「需求原文未要求治理能力」**。

本 spec 恢复其中一部分。因此它不是新增功能，而是**推翻一条有记录的决策**，必须同时改写 6 处决策记录（见 §9），否则文档与代码自相矛盾——这正是本项目刚清掉的那类漂移。

**已核实：无任何可恢复的历史实现。** `git log --all -S` 对 `model Report` / `enum ReportStatus` / `MemberRole` 声明 / `hiddenAt DateTime` 四个模式的命中提交数**均为 0**——当初在设计阶段即砍除，代码从未写过。这是新建。

## 2. 范围

**做**：小区管理员角色（含任命/撤换）、物品与留言的隐藏/恢复、简化的举报实体与处置、治理对 AI 语料面的延伸。

**不做**：硬删除、举报分类/分级/SLA/处理人字段、管理员扇出通知、回收站与延迟真删、举报统计报表、跨小区治理权。

## 3. 数据模型

```prisma
enum MemberRole   { MEMBER  ADMIN }
enum ReportStatus { PENDING  RESOLVED  DISMISSED }

CommunityMember.role  MemberRole @default(MEMBER)   // 唯一改到现有业务表的列
Item.hiddenAt         DateTime?                     // 与 status 正交
Message.hiddenAt      DateTime?

model Report {
  id         String       @id @default(cuid())
  communityId String                              // 冗余但必需：待办队列按它过滤
  itemId      String?
  messageId   String?
  reporterId  String
  reason      String       @db.VarChar(500)
  status      ReportStatus @default(PENDING)
  createdAt   DateTime     @default(now())
  resolvedAt  DateTime?
  @@index([communityId, status, createdAt])
}
```

三个有意识的取舍：

- **`hiddenAt` 不塞进 `ItemStatus`。** 曾考虑加一个 `HIDDEN` 状态值，那样列表谓词仍是 `status='ACTIVE'`，现有索引零改动。但**生命周期与处置结果是正交的两维**：一件 RESERVED 物品后来被发现是假货，必须能"既 RESERVED 又被隐藏"；合并进一个枚举就要求在两者间择一，且恢复时无法还原原状态。省一次索引改造，换来建模错误，不划算。
- **`Report → Item / Message` 用 `onDelete: Cascade`。** 三条理由：本期无任何硬删除路径，级联实际不触发；改用 `Restrict` 会让 seed 与现有集成测试大面积失败；举报证据的价值在**待办队列**而非长期审计，而长期审计本期不做。**若日后引入硬删除，这条必须重开。**
- **举报去重用部分唯一索引** `(itemId, reporterId) WHERE status='PENDING'`（messageId 同理）。一条语句防住同人刷同一物品的待办举报，且与 0002（PENDING 唯一）、0004（ACCEPTED 唯一）的既有先例同构。砍掉的是仪式感，不是约束。

`NotificationType` 加回 **`ITEM_HIDDEN` / `REPORT_RESOLVED`**——恰好是当初砍掉的那两个值，6 → 8。隐藏时通知发布者；处置举报时通知举报人；**恢复（取消隐藏）静默**，因为它是对上一次处置的纠正，再发一条只会制造噪音。

举报提交**不给管理员发通知**：那需要按小区枚举 ADMIN 并扇出，而 `GET /api/admin/reports` 待办队列端点已经覆盖同一需求。YAGNI。

## 4. 鉴权：管理员是按小区的

本系统**没有"创建小区"这条路径**——无 `/api/community*` 路由，`POST /api/auth/join` 遇未知邀请码直接 404，`Community` 只能由 `prisma/seed.ts:83` 产生。所以：

- 「创建者即管理员」**无处安放**：没有代码会写 `createdById`，加它也永远只有 seed 值，是个装饰性字段。按 YAGNI 砍。
- **ADMIN 的唯一自洽起点是 seed**：`prisma/seed.ts` 显式给若干 `CommunityMember` 写 `role=ADMIN`。
- ADMIN 可任命/撤换**本小区**他人角色。A 小区管理员对 B 小区无任何权力——这条保住了本仓「租户只来自会话」的红线。

**不变量：一个小区至少保留一名 ADMIN。** 任命端点在 `$transaction` 内对目标成员行 `SELECT … FOR UPDATE`，再统计该小区 ADMIN 数；若目标是最后一个 ADMIN 且动作是降级，拒绝。DB 层做不到（跨行聚合进不了 CHECK），沿用 `claims/service.ts` 已立的规矩：固定锁序、事务内无外部 I/O。

## 5. 可见性：一个谓词函数，三档身份

| 身份 | 物品列表 / 详情 |
|---|---|
| 本小区 ADMIN | **详情**可见全部（含已隐藏）；**列表**默认与普通成员一致，看已隐藏内容走 §7 的治理回收站端点 |
| 发布者本人 | 自己的全部可见（含已隐藏，DTO 带 `hidden` 标记） |
| 普通成员 | 仅 `hiddenAt IS NULL` |

实现为**单一可见性谓词函数**（`src/server/items/visibility.ts`），返回 SQL 片段供各查询拼装。禁止在多处手写 `hiddenAt` 判断——那是漂移的温床。

⚠️ 这里有个 self-review 抓出来的陷阱，记录以免重犯：若让 ADMIN 的**列表**直接返回"含隐藏全量"，则该查询谓词是 `communityId + status`（不带 `hiddenAt` 条件），**用不上 §8 里那条 `WHERE "hiddenAt" IS NULL` 的部分索引**，会退化成社区内全表扫。所以管理侧不看隐藏的入口必须是独立端点、独立谓词、独立部分索引，而不是复用住户列表再放宽条件。

## 6. 治理必须延伸到 AI 语料面（本设计最重要的一条）

现有两个工具会把社区语料喂进 prompt：

- `retrieve.ts` 的 `search_similar_items` —— 联 `Item` 做向量 top-k
- `tools.ts` 的 `getCommunitySettlementStats` —— 聚合社区成交记录

若物品被隐藏却仍进入这两条查询，**等于绕过治理、把违规内容当作「本小区同款参考」念给住户听**。治理是横切关注点，只挡 HTTP 读路径是不够的。

本设计要求两者都接入 §5 的可见性谓词，并由集成测试断言。这两个文件当前**未被并发会话占用**，可以独立实现。

## 7. 端点面

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/reports` | MEMBER | `{itemId \| messageId, reason}`，二者严格二选一；目标必须属于会话社区 |
| GET | `/api/admin/reports` | ADMIN | `?status=PENDING`，分页 |
| PATCH | `/api/admin/reports/[id]` | ADMIN | `{status: RESOLVED \| DISMISSED}`；同事务通知举报人 |
| PATCH | `/api/admin/items/[id]/visibility` | ADMIN | `{hidden: boolean}`；隐藏时同事务通知发布者 |
| PATCH | `/api/admin/messages/[id]/visibility` | ADMIN | 同上 |
| GET | `/api/admin/items?hidden=true` | ADMIN | 治理回收站：只列已隐藏物品，是取消隐藏的唯一入口 |
| GET | `/api/admin/members` | ADMIN | 成员 + 角色列表 |
| PATCH | `/api/admin/members/[id]` | ADMIN | `{role}`，受 §4 不变量约束 |

住户侧的 `GET /api/items` **不为 ADMIN 放宽**——见 §5 的索引陷阱说明。管理员看被隐藏的东西，走上面这条专用端点，谓词与索引都能精确匹配，且"回收站"在产品语义上也比"管理员眼中的世界不一样"更清楚。

**治理回收站是唯一的"看已隐藏物品"入口**（见 §5 陷阱说明），不提供"管理员浏览全量含隐藏"的能力——后者既有索引退化问题，也不是本期需要的功能。

事务边界：每个处置动作与其通知写入在**同一个 `$transaction`**（沿用 claims 模块口径）。锁序一律「先实体行（Item / Message / CommunityMember / Report）→ 再写 Notification」，不与既有 `Item → ClaimRequest` 形成环。

限流：`/api/reports` 复用 `src/server/rate-limit.ts` 的 `createRateLimiter`。举报是最容易被刷的入口，无限流的举报队列等于自我拒绝服务。

## 8. 迁移设计（`0006_moderation`）

**已在真库（PG 16.14）实测确认的两条**，非推断：

1. `CREATE TYPE` 新枚举 + 同事务内用它做列 `DEFAULT` —— **通过**。
2. `ALTER TYPE … ADD VALUE` 之后同事务内**使用**新标签 —— **报错**：
   `unsafe use of new value … HINT: New enum values must be committed before they can be used.`
   而 `prisma migrate deploy` 把每个迁移文件包在**一条事务**里执行。

因此语句顺序是硬约束：

```sql
-- ① CREATE TYPE "MemberRole" / "ReportStatus"
-- ② ALTER TABLE "CommunityMember" ADD COLUMN "role" … NOT NULL DEFAULT 'MEMBER'
-- ③ ALTER TABLE "Item" / "Message" ADD COLUMN "hiddenAt" TIMESTAMP(3)
-- ④ CREATE TABLE "Report" + 外键 + CHECK ((itemId IS NULL) <> (messageId IS NULL))
--    + 部分唯一索引（举报去重）
-- ⑤ 索引改造：DROP 现有 (communityId, status, publishedAt)，改建两条**互补的部分索引**
--    a) (communityId, status, publishedAt) WHERE "hiddenAt" IS NULL   ← 住户列表热路径
--    b) (communityId, "hiddenAt")          WHERE "hiddenAt" IS NOT NULL ← 治理回收站，行数极少
--    两条各自精确匹配自己的查询谓词，谁都不冗余；且都不再需要一条全量索引。
-- ⑥ 最后才 ALTER TYPE "NotificationType" ADD VALUE，且本文件内绝不使用这两个值
```

**⑤ 的连带后果（必须写进 schema 头注）**：Prisma 无法表达带 `WHERE` 的索引，所以 `schema.prisma` 里那条 `@@index([communityId, status, publishedAt])` **必须删除**、两条新索引全部由迁移建。这与 0002 / 0004 的既有先例一致，代价是 `prisma migrate diff` 会持续把它们报成 drift——本仓因此坚持手写迁移 + `migrate deploy`，从不用 `migrate dev` 生成，该纪律不变。

好处也要如实记下：`docs/tech-design-final.md:292` 曾声称移除 `hiddenAt` 让「列表谓词与索引完全匹配、F2 的索引未覆盖问题自然消失」。加回 `hiddenAt` 会复活该问题，但部分索引让它**以更强的形式解决**——谓词比原先更精确，索引体积更小。§9 要改写那句表述，不能让它继续按旧口径存在。

**编号**：`0006` 在字典序上晚于两个撞车的 `0004_`，因此全新库与现有库的应用顺序都正确，**本设计不受那个问题影响**。

## 9. 文档同步清单（漏一处就是新漂移）

| 位置 | 动作 |
|---|---|
| `prisma/schema.prisma:18-22` 头注 | 改写：砍除决策 → 部分恢复，并记新决策人与日期 |
| `docs/schema.prisma` | **逐字同步**（本仓硬规则） |
| `docs/tech-design-final.md:33` | 砍除清单 → 修订 |
| `docs/tech-design-final.md:292` | 索引"自然消失"表述 → 改为部分索引方案 |
| `docs/tech-design-final.md:1146` | `/admin` 管理台已砍除 → 恢复端点说明 |
| `docs/tech-design-final.md:1188` | 取舍表「举报+管理员隐藏 = 砍」→ 部分恢复 |
| `docs/tech-design-final.md:1371` | 决策表同上 |
| `docs/er-diagram-final.mermaid` | 加 `Report` 表、`role`、`hiddenAt` |
| `docs/api-contract.md` | 新增 §治理端点 |
| `README.md` 已知限制 | 加：无硬删除、恢复静默、举报不做管理员扇出 |

## 10. 测试矩阵

**单测（纯函数/mock）**：可见性谓词三档分支；最后 ADMIN 判定；`itemId/messageId` 互斥校验；`ReportStatus` 迁移合法性。

**集成测试（真 Postgres，`RUN_INTEGRATION=1`）**：

1. 跨租户：A 小区 ADMIN 隐藏/处置 B 小区资源 → 403/404（IDOR 红线）
2. 可见性三档：同一查询在成员/发布者/ADMIN 三种身份下结果集正确
3. 发布者仍能在 `/api/me/items` 看到被自己隐藏的物品，带标记
4. `Report` 的 CHECK：同时传 `itemId` 与 `messageId` → DB 报错被收敛成 400
5. 部分唯一索引：同人同物品重复 PENDING 举报 → 409
6. **并发降级**：两个 ADMIN 互相撤权，`Promise.all` ≥10 轮 → 小区 ADMIN 数恒 ≥1
7. **AI 语料面**：隐藏物品不出现在 `search_similar_items` 结果，也不进 `getCommunitySettlementStats` 聚合
8. `ITEM_HIDDEN` 通知发给发布者且与隐藏动作同事务（隐藏回滚则通知不存在）
9. 角色变更后权限即时生效，不受任何缓存影响
10. **治理回收站**：`GET /api/admin/items?hidden=true` 只返回已隐藏物品，且普通成员调用它拿 403；同查询走 `WHERE "hiddenAt" IS NOT NULL` 部分索引
11. **住户列表不被 ADMIN 身份放宽**：ADMIN 调 `GET /api/items` 的结果集与普通成员一致（防止 §5 那个索引退化被当成"功能"实现回来）
12. `0006` 在全新库上可应用（CI 覆盖）

**覆盖率提醒**：本仓覆盖率门禁是 unit-only 口径（`test:integration` 不带 `--coverage`）。上面 1–10 全部落在集成测试里，意味着**它们在门禁数字上不可见**。这是后端评审记录的根因主题之一，本功能不试图修复它，但要在 PR 说明里点明，别让"覆盖率绿"被误读成"治理被测过"。

## 11. 实现前置条件（阻塞项）

本功能必须修改的 12 个文件中，**9 个当前带并发会话的未提交改动**，且活跃到分钟级：

```
prisma/schema.prisma              14:08   docs/schema.prisma         M
src/server/items/sql.ts           14:55   src/server/items/service.ts 14:04
src/shared/schemas.ts             14:56   src/server/notifications/service.ts 14:55
src/server/auth/session.ts        13:44   src/server/rate-limit.ts    M
README.md                         M
```

干净可独立动的只有：`src/server/auth/guard.ts`、`src/server/messages/service.ts`、`src/server/ai/retrieve.ts`、`src/server/ai/tools.ts`、`docs/er-diagram-final.mermaid`，以及全部新建文件。

**因此实现分两批**：

- **第一批（现在可做，零冲突）**：`0006` 迁移、`items/visibility.ts`、`reports/` 新模块、`ai/retrieve.ts` + `ai/tools.ts` 接入可见性谓词、其对应测试。
- **第二批（等对方提交后）**：`schema.prisma` 模型与枚举声明、`shared/schemas.ts` DTO、`items/sql.ts` + `items/service.ts` 谓词接线、`auth/session.ts` 的 Viewer 角色维度、`notifications/service.ts`、`README.md`。

这个切法也符合本项目既有约定：只收口无冲突文件。

## 12. 已定的次要问题（原列为"未决"，self-review 时改为决定）

1. **`Viewer` 不携带 `role`**，改为按 `(userId, communityId)` 现查。理由：角色可被即时撤换，塞进会话令牌等于制造一个"已被撤权的人仍是管理员"的缓存窗口——权限模型里最不该有陈旧的一维。代价是每次治理请求多一次单行索引查询，可接受。
2. **举报 `reason` 必填，`VarChar(500)` + `min(2)`**。必填能抑制无意义刷单；这与"简化"不冲突——简化砍的是分类/分级/SLA/处理人，不是砍掉最低可用信息。
3. **`DISMISSED` 不附理由字段**，本期不做。它只对"多人复核的审核台"有意义，而本期审核者只有同小区的 ADMIN，没有复核链路。
4. **取消隐藏（恢复）静默不通知**。理由见 §3——它是对上一次处置的纠正，再发一条只会让通知列表出现成对的"被隐藏 / 已恢复"噪音。
5. **回收站只列物品，不列被隐藏的留言**。留言治理仍支持隐藏/恢复动作，但本期不做留言回收站视图；管理员从举报队列能定位到具体留言，够用。
