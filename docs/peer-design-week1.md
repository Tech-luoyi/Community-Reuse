# 参照方案（第三方·一周版）原文归档

> 来源：用户提供的第三方技术方案。周期前提：**1 周**（其文档注明"本轮补充：实际开发周期按 1 周规划；原始文档中的 24 小时约束以最新安排为准"）。
> 本文件为**只读参照基线**，用于定稿融合。已知问题见文末「主理人核出的缺陷」。

## 1. 方案概述

- 产品定位：面向小区、楼栋或办公室内部的轻量闲置物品流转工具，解决微信群消息沉没、物品状态不明确、交易沟通成本高的问题。
- 实现假设：使用"小区邀请码 + 昵称"完成轻量成员准入，不引入手机号实名和复杂账号体系；一个用户可加入多个小区/楼栋空间，默认只浏览当前空间数据；首页展示未归档物品，默认按发布时间倒序；支持关键词搜索名称和描述；支持按交易方式、物品状态过滤；支持"我要领取"申请，发布者可确认领取人和约定时间地点；支持图片真实上传、收藏、站内通知和基础举报。
- 明确不做：在线支付、物流、复杂信用分、实时聊天、强实名认证。

## 2. 功能范围

| 模块 | 一周交付内容 | 优先级 |
| --- | --- | --- |
| 社区准入 | 邀请码加入小区/楼栋、当前空间切换、成员身份 | P0 |
| 物品浏览 | 卡片列表、详情页、空状态、加载和错误状态 | P0 |
| 物品发布 | 名称、描述、交易方式、价格、最多 6 张图片、当前用户昵称 | P0 |
| 检索筛选 | 关键词搜索、交易方式、分类、状态、新鲜度、排序 | P0 |
| 新鲜度 | 24h 内"刚上架"、24-72h"新上架"、72h 后"已上架 X 天" | P0 |
| 领取申请 | 申请领取、填写备注、期望时间和地点 | P0 |
| 预约状态 | 发布者接受/拒绝申请，物品进入"已预约"，完成后归档 | P0 |
| 联系信息 | 仅在申请被接受后展示联系方式或约定信息 | P0 |
| 归档 | 发布者标记"已送出"，从主列表隐藏但保留历史 | P0 |
| 收藏 | 收藏物品，在"我的收藏"中查看 | P1 |
| 站内通知 | 新申请、申请结果、预约变更和归档结果 | P1 |
| 基础治理 | 举报物品、管理员隐藏物品、成员管理 | P1 |

本周暂不做：支付退款担保、快递配送、实时聊天语音、复杂信用体系、推荐算法、外部消息通道、多地域多租户运营后台、担保与自动结算。

## 3. 总体架构（原文）

```text
浏览器 / 移动端 H5
        |
        v
Next.js App Router
- 页面渲染
- Route Handler API
- 表单校验
- 服务端鉴权
        |
        v
   Prisma ORM
        |
        v
   PostgreSQL
        |
        +--> S3 兼容对象存储（图片）
        |
        +--> 站内通知（数据库）
```

推荐技术栈：Next.js 15、React、TypeScript；Tailwind CSS + shadcn/ui；Next.js Route Handlers；PostgreSQL；Prisma；Zod；React Hook Form；图片 S3 兼容对象存储（开发 MinIO，远端 Cloudflare R2 / OSS / S3）；Lucide React；Vitest + Playwright；Docker Compose，可部署 Railway / Render / Fly.io。

选单体全栈的理由（原文）：前后端共享 TypeScript 类型，减少接口沟通成本；页面、API、数据库迁移集中在一个仓库，适合一周内快速迭代；本地启动链路短；图片和通知通过独立适配层接入，后续可拆分为独立服务。

## 4. 核心业务设计（原文）

### 4.1 物品状态

```text
ACTIVE  ->  RESERVED  ->  ARCHIVED
  |          |
  +----------+
```

- `ACTIVE`：可浏览、可搜索、可被领取；
- `RESERVED`：发布者已接受某个领取申请，暂时为该申请人保留；
- `ARCHIVED`：已送出或已下架，不出现在默认列表，但历史记录仍保留；
- `RESERVED` 可因预约取消或超时回到 `ACTIVE`；
- 归档操作必须校验当前用户是发布者。

### 4.2 领取申请与预约

```text
申请人提交领取申请
        |
        v
PENDING -> ACCEPTED -> COMPLETED
  |          |
  v          v
REJECTED   CANCELED
```

发布者接受申请后：①物品变为 `RESERVED`；②其他未处理申请自动标记为 `REJECTED`；③双方在站内看到约定信息；④发布者完成线下交接后归档。目的是在不实现实时聊天的前提下，减少"私聊约时间、约地点、反复爽约"的问题。

### 4.3 交易方式（枚举，避免自由文本导致筛选困难）

- `FREE` 免费送；`PAY_WHATEVER` 随便给；`FIXED_PRICE` 标价；`OTHER` 其他。
- `FIXED_PRICE` 时保存可选价格字段；其他交易方式价格为空。

### 4.4 物品新鲜度

以服务端时间和 `publishedAt` 计算，**不将标签持久化**，避免定时任务和数据不一致。

| 时间差 | 展示文案 | 建议样式 |
| --- | --- | --- |
| `< 24h` | 刚上架 | 强调色标签 |
| `24h <= age < 72h` | 新上架 | 次强调色标签 |
| `>= 72h` | 已上架 X 天 | 中性标签 |

```ts
function getFreshness(publishedAt: Date, now = new Date()) {
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3600000;
  if (ageHours < 24) return { code: 'JUST_LISTED', label: '刚上架' };
  if (ageHours < 72) return { code: 'NEW', label: '新上架' };
  const days = Math.floor(ageHours / 24);
  return { code: 'OLDER', label: `已上架 ${days} 天` };
}
```

### 4.5 列表排序（原文）

默认排序：①未归档优先；②新鲜度优先；③`publishedAt DESC`。
支持切换：最新发布、最早发布、仅看刚上架、仅看可领取。

## 5. 数据模型（原文 Prisma schema，逐字保留）

```prisma
enum MemberRole { MEMBER ADMIN }
enum ItemStatus { ACTIVE RESERVED ARCHIVED }
enum TradeType { FREE PAY_WHATEVER FIXED_PRICE OTHER }
enum ClaimStatus { PENDING ACCEPTED REJECTED CANCELED COMPLETED }

model Community {
  id         String            @id @default(cuid())
  name       String
  inviteCode String            @unique
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt
  members    CommunityMember[]
  items      Item[]
}

model CommunityMember {
  id          String     @id @default(cuid())
  communityId String
  userId      String
  role        MemberRole @default(MEMBER)
  joinedAt    DateTime   @default(now())
  community   Community  @relation(fields: [communityId], references: [id], onDelete: Cascade)
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([communityId, userId])
  @@index([userId])
}

model User {
  id            String            @id @default(cuid())
  nickname      String
  deviceKey     String?           @unique
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  memberships   CommunityMember[]
  items         Item[]
  favorites     Favorite[]
  claimRequests ClaimRequest[]
  notifications Notification[]
}

model Item {
  id          String      @id @default(cuid())
  communityId String
  ownerId     String
  name        String
  category    String?
  description String
  tradeType   TradeType
  price       Decimal?    @db.Decimal(10, 2)
  contactText String?
  status      ItemStatus  @default(ACTIVE)
  publishedAt DateTime    @default(now())
  reservedAt  DateTime?
  archivedAt  DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  community   Community   @relation(fields: [communityId], references: [id])
  owner       User        @relation(fields: [ownerId], references: [id])
  images      ItemImage[]
  claims      ClaimRequest[]
  favorites   Favorite[]
  @@index([communityId, status, publishedAt])
  @@index([communityId, tradeType, status])
  @@index([ownerId, status])
}

model ItemImage {
  id        String @id @default(cuid())
  itemId    String
  url       String
  sortOrder Int    @default(0)
  item      Item   @relation(fields: [itemId], references: [id], onDelete: Cascade)
  @@index([itemId, sortOrder])
}

model ClaimRequest {
  id                String      @id @default(cuid())
  itemId            String
  applicantId       String
  message           String?
  preferredAt       DateTime?
  preferredLocation String?
  status            ClaimStatus @default(PENDING)
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  acceptedAt        DateTime?
  completedAt       DateTime?
  item              Item        @relation(fields: [itemId], references: [id], onDelete: Cascade)
  applicant         User        @relation(fields: [applicantId], references: [id])
  @@index([itemId, status])
  @@index([applicantId, status])
}

model Favorite {
  id        String   @id @default(cuid())
  userId    String
  itemId    String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  item      Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  @@unique([userId, itemId])
  @@index([userId, createdAt])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  type      String
  title     String
  content   String
  readAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, readAt, createdAt])
}
```

### 5.3 数据完整性规则（原文）

- 名称 1-80 字符；描述 1-2,000 字符；昵称 1-30 字符；
- 每件物品最多 6 张图片；价格必须 >= 0；`FIXED_PRICE` 必须填写价格；
- 只有社区成员可以浏览、发布和提交领取申请；
- 同一用户对同一物品最多保留一个有效的 `PENDING` 申请；
- 只有发布者可以接受、拒绝和完成领取申请；
- 已归档物品不允许再次被普通用户修改；
- 归档时写入 `archivedAt`，不物理删除数据。

## 6. API 设计（原文要点）

- `GET /api/items`：查询参数 `q / communityId / category / tradeType / status(默认 ACTIVE) / freshness / favorite / sort(latest|oldest) / page(1) / pageSize(20)`；返回 `{ data: [...], pagination: { page, pageSize, total } }`。
- `GET /api/items/:id`：返回物品完整信息、发布者昵称、图片列表、当前状态和新鲜度标签。
- `POST /api/items`：请求体 `{ communityId, name, category, description, tradeType, price, contactText, imageKeys[] }`；服务端 Zod 校验 → 校验社区成员 → 创建或复用用户 → 创建 Item 与 ItemImage → 返回详情。
- `POST /api/items/:id/claims`：请求体 `{ message, preferredAt, preferredLocation }`；仅允许同社区成员对 `ACTIVE` 物品提交，并向发布者创建站内通知。
- `GET /api/me/claims`：查询当前用户发起或收到的申请。
- `POST /api/claims/:id/accept`：**事务**内完成：目标申请 → `ACCEPTED`；物品 → `RESERVED`；同物品其他 `PENDING` → `REJECTED`；创建申请结果通知。
- `POST /api/claims/:id/complete`：申请 → `COMPLETED`，物品 → `ARCHIVED`。
- `POST /api/items/:id/favorite`、`GET /api/me/favorites`、`GET /api/me/notifications`、`POST /api/me/notifications/:id/read`。
- `POST /api/items/:id/archive`：校验发布者身份后写 `{ status: ARCHIVED, archivedAt }`。
- `POST /api/uploads/presign`：服务端校验类型和大小后返回预签名 URL，浏览器直传，发布时只提交对象存储 Key。限制：单张 <= 5MB，仅 JPG/PNG/WebP，最多 6 张。

## 7. 页面与交互（原文）

路由：`/`、`/join`、`/items/new`、`/items/[id]`、`/requests`、`/favorites`、`/notifications`、`/archive`、`/admin`。

首页：顶部产品名 + 搜索框 + "发布物品"按钮；筛选栏（分类/交易方式/状态/新鲜度/排序）；响应式卡片列表；卡片含图片、名称、交易方式、价格、描述摘要、新鲜度、发布时间、发布者；空状态提供"发布第一件物品"入口；移动端筛选项收进抽屉。

发布页：名称、分类、描述、交易方式、价格（仅标价显示）、最多 6 张图片上传预览、联系说明；昵称由会话提供，不允许请求体伪造；实时校验、提交中禁用按钮、成功跳详情、失败保留表单内容。

详情页：完整图片与描述；明确显示"可领取/已预约/已送出"；成员可填时间地点备注提交申请；发布者可查看/接受/拒绝；接受后展示双方约定信息；发布者可完成交接并归档；收藏与举报入口；已归档物品保留历史浏览。

## 8. 权限与安全（原文）

轻量成员鉴权：①输入邀请码和昵称；②服务端校验邀请码，创建或复用 `User`；③写入 `CommunityMember`；④签发 HttpOnly、Secure、SameSite=Lax 会话 Cookie；⑤所有接口从服务端会话解析当前用户。管理员通过 `CommunityMember.role` 区分。

输入与接口安全：全部请求体 Zod 校验；输出由 React 转义防 XSS；图片限制类型/大小/数量，服务端重新生成对象存储 Key；列表接口限制分页大小；接受申请与完成交接使用数据库事务，避免并发重复预约；归档/取消预约/收藏增加幂等；管理员隐藏物品保留操作记录；生产环境用环境变量注入连接串。

## 9. 本地开发与部署（原文）

```bash
pnpm install
cp .env.example .env
docker compose up -d db storage
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev
```

Docker Compose 两个服务：`postgres:16-alpine`（端口 5432，卷 `postgres_data`）与 `minio/minio`（端口 9000/9001，卷 `minio_data`）。

远端部署：创建 PG 与对象存储 Bucket → 配 `DATABASE_URL` / `NEXT_PUBLIC_APP_URL` / `S3_ENDPOINT` / `S3_BUCKET` → `prisma migrate deploy` → 构建启动 → `/api/health` 验证 → 上传一张图片并完成一次领取申请验证链路。

## 10. 测试与验收（原文）

单测：新鲜度边界（0/23/24/71/72/96 小时）、交易方式与价格组合校验、搜索筛选参数解析、物品状态转换、领取申请状态转换与**并发接受**、社区成员权限校验、归档/收藏/通知幂等性、图片类型大小数量校验。

E2E 主流程：邀请码加入空间 → 发布带图片的免费物品 → 首页看到"刚上架"并可搜索 → 另一成员收藏并提交申请 → 发布者接受，物品变"已预约" → 双方在通知中心看到结果 → 发布者完成交接归档 → 默认首页不再展示、归档列表仍可查 → 非成员访问被拒。

验收标准要点：本地一键启动；完整闭环；新鲜度边界正确；图片可上传预览回显；**不会出现两个用户同时被接受**；刷新后数据仍在；移动端无横向溢出；发布失败/无数据/网络错误均有可理解状态；归档数据不物理删除；README 含启动方式、技术栈、数据库图、演示邀请码和操作说明。

## 11. 一周开发计划（原文）

| 天数 | 任务 | 产出 |
| --- | --- | --- |
| 第 1 天 | 初始化项目、设计信息架构、确定数据模型和交互稿 | 可运行的 Next.js 工程、页面草图、ER 图 |
| 第 2 天 | Prisma Schema、迁移、社区邀请码、成员会话 | 数据库可读写、加入空间闭环 |
| 第 3 天 | 首页列表、详情页、搜索筛选、新鲜度 | 浏览和检索闭环 |
| 第 4 天 | 发布表单、图片上传、对象存储适配 | 带图片发布闭环 |
| 第 5 天 | 领取申请、预约、接受/拒绝、通知中心 | 交易协作闭环 |
| 第 6 天 | 收藏、归档、举报、管理员基础页面、响应式优化 | 完整演示版本 |
| 第 7 天 | 单元测试、E2E、部署、README、视频和问题修复 | 最终提交材料 |

## 12. 演示脚本建议（原文）

5 分钟：介绍痛点 → 邀请码加入空间 → 展示首页检索 → 发布带图片物品 → 另一用户收藏并提交申请 → 发布者接受展示"已预约"和双方通知 → 完成交接归档展示主列表隐藏与历史保留 → 展示管理员举报处理、架构图、ER 图和技术栈 → 说明支付/物流/实时聊天属下一阶段边界。

## 13. 后续演进（原文）

手机号/企业微信/OAuth 登录 → 评价与信用记录 → 预约过期自动释放和提醒 → 评论与图片审核 → 外部通知通道 → 多小区运营后台与统计 → 行为推荐 → 同城配送与支付。

---

## ⚠️ 主理人核出的缺陷（定稿必须修掉）

| # | 位置 | 问题 | 定稿处理 |
|---|---|---|---|
| D1 | `Item.contactText` + §4「联系信息仅在申请被接受后展示」+ §6.2「详情返回物品完整信息」 | 联系方式是普通列且随详情接口返回，**任何人打开详情页即可看到联系方式**，与自身约束矛盾 | `contactText` 移出 Item，改为「仅在被接受的 `ClaimRequest` 上可见」；详情接口对非发布者/非被接受者做字段裁剪 |
| D2 | §4.5 默认排序 + §6.1 `status` 默认 ACTIVE | 「未归档优先 + 新鲜度优先 + publishedAt DESC」三条语义重复（都是时间倒序）；且默认过滤掉 ARCHIVED 后「未归档优先」永不生效 | 默认排序收敛为单一定义：`publishedAt DESC`（新鲜度即时间序），删除冗余条款；ARCHIVED 只出现在 `/archive` |
| D3 | §5.3 标题「数据完整性规则」 | 名称/描述/昵称长度、价格 >= 0、图片数量上限在 Prisma schema 中**无任何强制**，实际全靠 Zod；文件层级导致误解为 DB 兜底 | 拆成「DB 层约束（唯一/外键/非空/检查）」与「应用层校验（Zod/长度/数量）」，逐条标注落点；`FIXED_PRICE` 必填价格用 DB CHECK 或事务内断言 |
| D4 | `User.deviceKey String? @unique` | 声明了但全文未解释用途，身份实际走邀请码 + Cookie，属死字段 | 删除，或明确用途并写入文档 |
| D5 | `Notification.type String` | 其他枚举都用 Prisma enum，此处用裸 String，风格不一致且无法约束取值 | 改 `NotificationType` enum |
| D6 | §6.1 响应示例 | 查询支持 `category` 过滤，但响应示例没有 `category` 字段 | 补入响应 DTO |
| D7 | §11 第 7 天 | 单测 + E2E + 部署 + README + 录视频挤在一天 | 重排：测试前移并贯穿，第 6-7 天只做验收/部署/录制 |
| D8 | §3.2 选型理由 | 以"前后端共享 TS 类型、减少接口沟通成本"为卖点，与考卷「前后端是否解耦」评分项存在张力 | 定稿必须明确：共享的只有 Zod schema 与 DTO 类型；Route Handler 不得依赖任何前端组件类型；接口契约独立成文 |

## ❌ 原文缺失的两个需求模块（定稿必须补回）

1. **④ 数据看板**（需求原文第 4 条功能要求）：本月发布数 / 本月成交数 / 当前在售数；"最快被领走的物品"（发布→标记已送出的时间最短）；"最想要的物品"（被最多人表达意向但未成交的）。
2. **⑤ 使用 LLM API**（需求原文第 5 条功能要求，且对准考察重点「对大模型的熟悉」）：
   - 智能定价建议：输入名称与描述，返回建议定价区间或"建议免费送"判断；
   - 物品描述优化：把粗糙描述润色为吸引人的转让文案；
   - 交易 FAQ 自动回复：针对"还在吗/能否自提/能否刀"等常见提问，结合物品信息生成回复建议。

3. **③ 公开留言板**（需求原文第 3 条功能要求）：围绕每件物品可公开留言问答（原文举例"还在吗？""几成新？"），避免重复私聊。
   —— 原文用私密的 `ClaimRequest.message` 替代，二者不等价，定稿需补一张公开留言表，且留言带 `sender_type` 以承载 LLM 生成的回复建议。
