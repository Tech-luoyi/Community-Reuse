# 邻里流转 · 定稿 REST API 契约（独立文档）

> 本文件是「前后端解耦」的书面证据，**可独立成立**：
> - 前端只依赖本文的 HTTP 契约与 `src/shared/` 下的 Zod schema / DTO 类型；
> - **后端 Route Handler 不得 import 任何前端组件类型**（`src/components/**`）；
> - 唯一的共享边界是 `src/shared/`（Zod schema + DTO 类型），除此之外前后端互不引用。
> 枚举值 / 字段名 / 索引与 `docs/schema.prisma`、`docs/er-diagram-final.mermaid` 三处保持一致。

## 0. 通用约定

### 0.1 响应信封

**成功**（HTTP 200 / 201）：
```json
{ "data": { }, "pagination": { "page": 1, "pageSize": 20, "total": 37 } }
```
> `pagination` 仅列表接口返回。

**失败**（HTTP 4xx / 5xx）：
```json
{ "error": { "code": "CLAIM_CONFLICT", "message": "该物品已被预约", "details": [] } }
```

### 0.2 错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_INPUT` | Zod 校验失败（`details` 为字段错误列表） |
| 401 | `UNAUTHENTICATED` | 无有效会话 Cookie |
| 403 | `FORBIDDEN` | 已登录但无权操作（非成员/非发布者/非管理员） |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CLAIM_CONFLICT` | 状态冲突（物品非 ACTIVE / 重复申请 / 已被预约） |
| 409 | `CONFLICT` | 唯一约束冲突（如重复收藏） |
| 413 | `PAYLOAD_TOO_LARGE` | 图片超限 |
| 429 | `RATE_LIMITED` | 触发限流（LLM 接口） |
| 500 | `INTERNAL` | 服务器内部错误 |
| 503 | `DEPENDENCY_UNAVAILABLE` | 依赖不可用（DB）。**LLM 不可用不报错**，走降级并置 `degraded:true` |

### 0.3 鉴权与多租户

- 鉴权：`join` 成功后签发 **HttpOnly + Secure + SameSite=Lax** 会话 Cookie；此后所有请求从服务端会话解析当前用户。
- 多租户：除 `join` / `health` 外，涉及社区数据的接口均需满足「当前用户是该 `communityId` 的 `CommunityMember`」。
- 权限角色：`GUEST`（未登录）/ `MEMBER` / `OWNER`（物品发布者）/ `ACCEPTED_APPLICANT`（被接受的申请人）。
  > 定稿决策：**不设 `ADMIN` 角色**。「举报 + 管理员隐藏」已砍除，`MemberRole` 与 `CommunityMember.role` 随之移除——所有权限均由**关系**推导（你是不是成员、是不是发布者、是不是被接受的申请人），不依赖角色列。若后续要做成员管理，加回 role 是一次普通 migration。
- **字段裁剪（D1 硬规则）**：`contactText` **永不**出现在物品详情响应中；仅当存在一条 `ACCEPTED`/`COMPLETED` 的 `ClaimRequest` 时，才向该笔交易的对手方返回对方 `contactText`。

---

## 1. 鉴权与身份

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| POST | `/api/auth/join` | GUEST | `{ inviteCode: string, nickname: string }` | `201 { data: { user, community, memberships } }` + Set-Cookie | `INVALID_INPUT`, `NOT_FOUND`(邀请码错) |
| POST | `/api/auth/switch` | MEMBER | `{ communityId }` | `200 { data: { community } }` | `FORBIDDEN` |
| POST | `/api/auth/logout` | MEMBER | — | `200 { data: { ok: true } }` | — |
| GET | `/api/me` | MEMBER | — | `200 { data: { user:{id,nickname,contactText}, memberships[], currentCommunity } }` | `UNAUTHENTICATED` |
| PATCH | `/api/me` | MEMBER | `{ nickname?: string, contactText?: string }` | `200 { data: { user: {...} } }` | `INVALID_INPUT`, `UNAUTHENTICATED` |

> **`contactText` 写入路径（D1 闭环）**：唯一的写入入口是 `PATCH /api/me`。规则——`contactText` 长度 ≤120（对齐 `schema.prisma` 的 `@db.VarChar(120)`）；传**空串等价于清空为 `null`**；`nickname` 可与 `contactText` 一并更新（≤30）。写入**不改变**可见性规则：仅当存在该用户参与的 `ACCEPTED`/`COMPLETED` 申请时，才向交易对手方返回（见 §0.3、§4）。前端在 `/me`（个人资料页）暴露该字段，文案标注「被接受后才对交易对手方展示」；对方未填写时，对手方侧显示「对方未填写联系方式」（不留空白）。

`join` 请求示例：
```json
{ "inviteCode": "LINFENG-2026", "nickname": "3栋-老王" }
```
`join` 响应示例：
```json
{ "data": {
  "user": { "id": "u_1", "nickname": "3栋-老王" },
  "community": { "id": "c_1", "name": "临风小区" },
  "memberships": [{ "communityId": "c_1" }]
}}
```
> 定稿决策：因砍除治理模块，`CommunityMember.role` 已移除，`memberships` 不再返回 `role`。

---

## 2. 物品（发布 / 浏览 / 检索）

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| GET | `/api/items` | MEMBER | query：`q?`, `category?`, `tradeType?`(FREE\|PAY_WHATEVER\|FIXED_PRICE\|OTHER), `status?`(默认 `ACTIVE`), `freshness?`(JUST_LISTED\|NEW\|OLDER), `favorite?`, `sort?`(默认 `latest`), `page=1`, `pageSize=20` | `200 { data: ItemDto[], pagination }` | `INVALID_INPUT`, `UNAUTHENTICATED` |
| POST | `/api/items` | MEMBER | `{ communityId, name, category?, description, tradeType, price?, imageKeys?: string[] }` | `201 { data: ItemDto }` | `INVALID_INPUT`, `FORBIDDEN`, `PAYLOAD_TOO_LARGE` |
| GET | `/api/items/:id` | MEMBER | — | `200 { data: ItemDetailDto }` | `NOT_FOUND`, `FORBIDDEN` |
| PATCH | `/api/items/:id` | OWNER | 同 POST 可选字段集 | `200 { data: ItemDto }` | `INVALID_INPUT`, `FORBIDDEN`, `CLAIM_CONFLICT`(非 ACTIVE) |
| POST | `/api/items/:id/archive` | OWNER | — | `200 { data: ItemDto }` | `FORBIDDEN`, `CLAIM_CONFLICT` |

**`ItemDto`**（列表项；D6：补入 `category`）：
```json
{
  "id": "i_1",
  "communityId": "c_1",
  "name": "九成新婴儿车",
  "category": "母婴",
  "description": "宝宝大了用不上，轮子好推，可折叠。",
  "tradeType": "FREE",
  "price": null,
  "status": "ACTIVE",
  "publishedAt": "2026-09-28T06:00:00.000Z",
  "coverUrl": "/uploads/abc.jpg",
  "owner": { "id": "u_1", "nickname": "3栋-老王" },
  "favoriteCount": 2,
  "claimCount": 3,
  "freshness": { "code": "JUST_LISTED", "label": "刚上架", "ageHours": 3.2 }
}
```

**`ItemDetailDto`** = `ItemDto` + 以下字段：
```json
{
  "images": [{ "url": "/uploads/abc.jpg", "sortOrder": 0 }],
  "viewer": { "isOwner": false, "isFavorite": true, "canClaim": true, "isAcceptedApplicant": false },
  "contactText": null
}
```
> **D1**：`contactText` 在这里对**任何人**都恒为 `null`（字段存在只是为契约稳定；联系方式只在 §4 领取申请接口、且仅对交易对手方返回）。`viewer` 为前端按钮态与字段裁剪服务。

**D2 排序（收敛为单一定义）**：默认 `sort=latest` ⇔ `WHERE status='ACTIVE' ORDER BY publishedAt DESC`（新鲜度即时间序，删除"未归档优先/新鲜度优先"冗余条款）。`sort=oldest` 为升序。`ARCHIVED` 不出现在本接口，仅经 `/api/me/items?status=ARCHIVED` 或 `/api/items?status=ARCHIVED`（归档视图）查看。
> 定稿决策：`hiddenAt` 已随治理模块砍除，因此**索引 `@@index([communityId, status, publishedAt])` 与本查询谓词完全匹配**，不存在残余过滤。

---

## 3. 图片上传

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| POST | `/api/uploads` | MEMBER | `multipart/form-data`：`file`（JPG/PNG/WebP，单张 ≤5MB） | `201 { data: { key, url } }` | `INVALID_INPUT`(类型/大小), `PAYLOAD_TOO_LARGE`, `RATE_LIMITED` |

> 由 `StorageAdapter` 落盘：默认实现写本地 `public/uploads/` 并返回 `{ key, url:"/uploads/<key>" }`；S3 兼容实现在定稿中**不做**（客户确认无需远端部署）。
> **定稿决策（图片压缩）**：在**前端**用 `canvas.toBlob()` 统一压到长边 ≤1600px、WebP `quality 0.8` 后再上传（零服务端原生依赖）；服务端仍**独立校验**类型 / 单张 ≤5MB / 数量 ≤6，不信任客户端。定稿**不引入 `sharp`**——原生二进制依赖在本项目已有前车之鉴（Prisma 引擎），1 周内不值得为缩略图赌它；若 P1 有余力再加服务端缩略图。
> **发布时只提交 `imageKeys[]`**，服务端校验数量 ≤6。

---

## 4. 领取申请与预约（核心状态机）

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| POST | `/api/items/:id/claims` | MEMBER（非发布者） | `{ message?, preferredAt?, preferredLocation? }` | `201 { data: ClaimDto }` | `INVALID_INPUT`, `CLAIM_CONFLICT`(物品非 ACTIVE / 已有 PENDING), `FORBIDDEN` |
| GET | `/api/items/:id/claims` | OWNER 或 申请人 | — | `200 { data: ClaimDto[] }` | `FORBIDDEN` |
| GET | `/api/me/claims` | MEMBER | query：`as=applied\|received`（我发起的 / 我收到的） | `200 { data: ClaimDto[] }` | — |
| POST | `/api/claims/:id/accept` | OWNER | — | `200 { data: ClaimDto }` | `FORBIDDEN`, `CLAIM_CONFLICT` |
| POST | `/api/claims/:id/reject` | OWNER | — | `200 { data: ClaimDto }` | `FORBIDDEN`, `CLAIM_CONFLICT` |
| POST | `/api/claims/:id/cancel` | 申请人 | — | `200 { data: ClaimDto }` | `FORBIDDEN`, `CLAIM_CONFLICT` |
| POST | `/api/claims/:id/complete` | OWNER | — | `200 { data: ClaimDto }` | `FORBIDDEN`, `CLAIM_CONFLICT` |

**`ClaimDto`**：
```json
{
  "id": "cl_1",
  "itemId": "i_1",
  "applicant": { "id": "u_2", "nickname": "5栋-小李" },
  "message": "今晚能拿",
  "preferredAt": "2026-09-28T12:00:00.000Z",
  "preferredLocation": "3栋楼下",
  "status": "ACCEPTED",
  "contactText": "微信 wang_3 (仅对手方可见)",
  "createdAt": "2026-09-28T08:00:00.000Z",
  "acceptedAt": "2026-09-28T09:00:00.000Z",
  "completedAt": null
}
```

**`accept` 事务契约**（并发安全，单事务内）：
1. 目标申请 `PENDING → ACCEPTED` 并写 `acceptedAt`；
2. 该 `Item` `ACTIVE → RESERVED` 并写 `reservedAt`；
3. 同物品其他 `PENDING` 申请批量 → `REJECTED`；
4. 为申请人生成 `CLAIM_ACCEPTED` 通知，为被拒者生成 `CLAIM_REJECTED` 通知。
> 并发下**不可能有两个申请同时被接受**：以 `SELECT ... FOR UPDATE` 锁物品行 + 目标申请 `PENDING` 前置校验（失败返回 `CLAIM_CONFLICT`）。

**`contactText` 可见性**：仅当 `status ∈ {ACCEPTED, COMPLETED}` 时，`ClaimDto.contactText` 返回**对方**的联系方式（发布者看到申请人、被接受申请人看到发布者）；`PENDING`/`REJECTED`/`CANCELED` 恒为 `null`。**填写入口**：`PATCH /api/me`（§1）——未填写的用户其联系方式为 `null`，对手方侧显示「对方未填写联系方式」。

---

## 5. 公开留言板（新增模块，承载 LLM 回复建议）

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| GET | `/api/items/:id/messages` | MEMBER | — | `200 { data: MessageDto[] }` | `NOT_FOUND` |
| POST | `/api/items/:id/messages` | MEMBER | `{ content: string }` | `201 { data: MessageDto }` | `INVALID_INPUT`, `FORBIDDEN` |

**`MessageDto`**：
```json
{
  "id": "m_1",
  "itemId": "i_1",
  "senderType": "USER",
  "author": { "id": "u_2", "nickname": "5栋-小李" },
  "content": "还在吗？",
  "createdAt": "2026-09-28T08:10:00.000Z"
}
```
> **AI 回复建议一键发送**：`POST /api/ai/faq` 生成的 `answer` 可由前端调用本接口提交，此时服务端写 `senderType:"AI"`、`authorId:null`（**仅发布者可发 AI 建议**，返回 `FORBIDDEN` 否则）。

---

## 6. 收藏 / 通知

> 定稿决策：**举报与治理（`/api/items/:id/reports`、`/api/admin/**`）已砍除**，对应 `Report` 表、`ReportStatus` / `MemberRole` 枚举、`Item.hiddenAt` 同步移除。

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| POST | `/api/items/:id/favorite` | MEMBER | — | `201 { data: { favorited: true } }` | `CONFLICT`(已收藏) |
| DELETE | `/api/items/:id/favorite` | MEMBER | — | `200 { data: { favorited: false } }` | `NOT_FOUND` |
| GET | `/api/me/favorites` | MEMBER | — | `200 { data: ItemDto[] }` | — |
| GET | `/api/me/items` | MEMBER | query：`status?`(ACTIVE\|RESERVED\|ARCHIVED) | `200 { data: ItemDto[] }` | — |
| GET | `/api/me/notifications` | MEMBER | query：`unreadOnly?` | `200 { data: NotificationDto[] }` | — |
| POST | `/api/me/notifications/:id/read` | MEMBER | — | `200 { data: NotificationDto }` | `FORBIDDEN` |

**`NotificationDto`**：
```json
{ "id": "n_1", "type": "CLAIM_ACCEPTED", "title": "申请已通过", "content": "你的申请已被接受，请与对方约定交接。", "readAt": null, "createdAt": "2026-09-28T09:00:00.000Z" }
```
> `NotificationType` 取值（6 个）：`CLAIM_RECEIVED` / `CLAIM_ACCEPTED` / `CLAIM_REJECTED` / `CLAIM_COMPLETED` / `ITEM_RESERVED` / `ITEM_ARCHIVED`。
> 原 `ITEM_HIDDEN` / `REPORT_RESOLVED` 随治理模块一并移除。

---

## 7. 数据看板（新增模块）

| Method | Path | 权限 | 请求 | 响应 | 错误 |
|---|---|---|---|---|---|
| GET | `/api/stats/community` | MEMBER | query：`communityId?`(默认当前空间) | `200 { data: StatsDto }` | `FORBIDDEN` |

**`StatsDto`**：
```json
{
  "monthPublished": 18,
  "monthCompleted": 7,
  "activeCount": 11,
  "fastestItem": { "id": "i_9", "name": "电磁炉", "durationMinutes": 42 },
  "mostWantedItem": { "id": "i_3", "name": "书架", "wantCount": 6 },
  "timezone": "Asia/Shanghai",
  "monthRange": { "start": "2026-09-01T00:00:00+08:00", "end": "2026-10-01T00:00:00+08:00" }
}
```
- `monthPublished`：`Item.publishedAt ∈ 本月` 计数；`monthCompleted`：`ClaimRequest.completedAt ∈ 本月 AND status=COMPLETED` 计数；`activeCount`：`Item.status=ACTIVE` 计数（`hiddenAt` 已随治理模块砍除，无此过滤）。
- `fastestItem`：`MIN(completedAt - Item.publishedAt)`，无成交则 `null`。
- `mostWantedItem`：`ClaimRequest` 按 `itemId` 分组计数，取「物品非 ARCHIVED 且无 COMPLETED」最大者，无则 `null`。
- **时区**：DB 存 UTC；聚合按 `Asia/Shanghai` 自然月（`monthRange` 显式回传，便于前端核对）。

---

## 8. LLM 能力（新增模块）

> 统一入口 `/api/ai/*`；均为 `POST`、需 `MEMBER` 权限。响应恒含 `degraded:boolean`、`source:'llm'|'rule'|'cache'`、`usedTools:boolean`、`toolCalls:number`；**降级不是错误**，HTTP 仍 200。
> **INC-1 增量**：`usedTools` / `toolCalls` 为新增字段；**`source` 取值不变**（仍三值）。请求体形状**不变**（无需前端改造即可继续调用；`usedTools/toolCalls` 为只增字段，前端可选消费）。

| Method | Path | 请求 | 响应 | 错误 |
|---|---|---|---|---|
| POST | `/api/ai/pricing` | `{ name, description?, category? }` | `200 { data: PricingResult }` | `INVALID_INPUT`, `RATE_LIMITED` |
| POST | `/api/ai/polish` | `{ rawText, name?, tradeType? }` | `200 { data: PolishResult }` | `INVALID_INPUT`, `RATE_LIMITED` |
| POST | `/api/ai/faq` | `{ itemId, question }` | `200 { data: FaqResult }` | `INVALID_INPUT`, `NOT_FOUND`, `RATE_LIMITED` |

```json
// PricingResult（INC-1：升级为工具调用定价；字段只增不改）
{ "mode": "PRICED", "priceRange": { "min": 30, "max": 60, "currency": "CNY" }, "reason": "同小区婴儿车近 5 台成交价集中在 30–60 元", "degraded": false, "source": "llm", "usedTools": true, "toolCalls": 1 }

// PolishResult（不涉及工具，两字段恒为 false/0）
{ "title": "九成新婴儿车转让", "description": "宝宝长大了用不上啦…", "highlights": ["可折叠", "轮子顺滑", "可自提"], "degraded": false, "source": "llm", "usedTools": false, "toolCalls": 0 }

// FaqResult（不涉及工具，两字段恒为 false/0）
{ "answer": "在的，随时可约自提～", "confidence": 0.86, "degraded": false, "source": "llm", "usedTools": false, "toolCalls": 0 }

// 降级示例（拔 Key / 工具失败 / 超时 / JSON 非法超重试）——HTTP 仍 200
{ "mode": "FREE", "priceRange": null, "reason": "小件日用品，建议直接赠送", "degraded": true, "source": "rule", "usedTools": false, "toolCalls": 0 }
```

### 8.1 `/api/ai/pricing` 工具调用与降级（INC-1 契约增量）

**请求**：**不变** —— `{ name: string, description?: string, category?: string }`。**前端不得、也无需**传 `communityId`：社区由服务端会话决定。

**模型侧工具声明**（服务端内部，不暴露给前端）：单一工具 `getCommunitySettlementStats`，参数仅 `{ category?, tradeType? }`（**无 `communityId`**），返回 `{ count, min, max, median, p25, p75, samples:[{name, price, tradeType, archivedAt}] }`，`samples ≤ 8`。详见 `tech-design-final.md` §6.5.5。

**响应字段语义**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `source` | `'llm' \| 'rule' \| 'cache'` | **取值不变**。「哪个引擎产出」。`cache` = 命中缓存；`llm` = 模型产出；`rule` = 规则兜底 |
| `degraded` | `boolean` | **仅当** `source='rule'` 时 `true` |
| `usedTools` | `boolean` | 本次输出是否**实际消费了工具数据**（`cache` 命中时取缓存体内记录值；`rule` 恒 `false`；**服务端预取模式亦为 `true`**，见下） |
| `toolCalls` | `number` | **实际执行的工具（DB 查询）次数**（≤1）。定义为「实际查询计数」而非「模型发起计数」：**function-call 与预取都计 1**。模型**未**调工具且**预取关闭/失败**时 `usedTools=false, toolCalls=0`，仍为合法 L1 结果。「由谁触发」用服务端日志 `toolMode ∈ {'model','prefetch','none'}` 区分，不进契约 |

**降级层级（两级 + 缓存短路，不是三级）**：

| 级 | 触发 | `source` / `degraded` / `usedTools` |
|---|---|---|
| L0 缓存 | 命中 L1/L2 | `cache` / `false` / 取缓存值 |
| L1 模型 | 工具增强成功；**或工具查询失败后去 `tools` 的恢复轮成功**；或模型直接作答；或**预取模式成功** | `llm` / `false` / `true` 或 `false` |
| L2 规则 | 无 Key / 模型超时(含恢复轮/修补轮) / 网络或 401/402 / JSON 非法**超重试** / deadline 耗尽 | `rule` / `true` / `false` |

> **R1（拔 Key 不崩）**：**工具查询失败不再直接降级**——先回退到「**无工具 LLM 恢复轮**」（`source:'llm'`）；**只有恢复轮也失败**（超时/4xx/JSON 仍非法）才落 `L2` 规则。**工具轮次超限**同理先走 `REPAIR`。这**既满足 R1**（最终兜底永远是 `degraded:true` 规则结果、HTTP 恒 200），又**避免能力倒退**（不因一次 DB 抖动就把 LLM 降成关键词规则）。
> **工具返回空集（`count=0`）不算失败**：属合法数据，继续 L1（`usedTools:true`、`degraded:false`）。
> **保险模式（预取降级）**：当模型**未**返回 `tool_calls`、或其 `arguments` 解析异常时，服务端**主动**用同一工具（同一会话 `communityId`）预取「本小区成交行情参考」注入 prompt 再让模型作答 ⇒ 表现为 `usedTools:true, toolCalls:1, source:'llm', degraded:false`（属 **L1 内部**，**不新增层级**）。开关 `AI_PRICING_PREFETCH` 默认**开**，置 `0` 关闭（关闭后尊重模型不调工具的直接作答）。**预取查询与 function-call 共用同一执行器与同一道隔离防线。**
> **跨租户隔离**：`communityId` 只来自服务端会话，工具入参不含该字段；工具执行的 SQL 强制 `WHERE communityId = <会话社区>`，`category/tradeType` 仅作参数绑定。**预取路径同样如此**。前端**无任何**途径影响查询范围。

**缓存指纹（服务端内部）**：定价缓存键 = `sha256(variant:'PRICING_TOOL_V1' + 规范化输入 + 社区数据指纹)`，其中社区数据指纹 = `sha256(count + max(updatedAt))`（`status=ARCHIVED AND price IS NOT NULL` 的归档集）。⇒ 社区成交数据变化后**不会**返回旧价。润色/FAQ 键维持 `sha256(kind + 规范化输入)`。

**时间预算**：每轮模型 ≤6s、工具 ≤1s、**全局硬闸 20s**（最坏路径 = 3 轮模型 + 1 次工具 = 19s ≤ 20s；超时即 `FALLBACK`）。前端应处理最长 ~20s 的等待（典型 3–7s；建议 inline loading + 可取消）。

---

## 9. 健康检查

| Method | Path | 权限 | 响应 |
|---|---|---|---|
| GET | `/api/health` | GUEST | `200 { data: { db: "ok", llm: true, storage: "local" } }` |

---

## 10. 契约与实现的边界规则（解耦硬约束）

1. 前端只 import：`src/shared/schemas.ts`、`src/shared/types.ts`、`src/lib/*`、`src/components/**`。
2. 后端（`src/server/**`、`src/app/api/**`）只 import：`src/shared/**`、`src/server/**`、npm 包。
3. **禁止** `src/server/**` 或 `src/app/api/**` import `src/components/**` 或 `src/app/**/page.tsx`。
4. 所有请求体/响应体形状由 `src/shared/schemas.ts` 的 Zod schema 定义，两端共用；DTO 类型由 `z.infer` 推导。
5. 新增字段/接口 → 先改本文件，再改 `src/shared/`，最后各自实现。
