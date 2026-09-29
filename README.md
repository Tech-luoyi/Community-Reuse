# 邻里流转（community-reuse）· 全栈工程

> 面向 **小区 / 楼栋 / 办公室** 的闲置物品流转工具。
> **后端** = `prisma/**`、`src/shared/**`、`src/server/**`、`src/app/api/**`、`tests/**`；
> **前端** = `src/app/**`（页面）、`src/components/**`、`src/hooks/**`、`src/lib/**`、`src/app/globals.css`。
> 同仓协作但受 **D8 解耦**硬约束（`eslint.config.mjs` 双向 `no-restricted-imports`）：
> 前端只可 import `src/shared/**`（Zod 契约 + DTO），禁止触碰 `src/server/**` 与 Route Handler；
> 后端禁止 import 页面 / 组件 / hooks / lib —— 通信一律走 HTTP + `docs/api-contract.md`。

## 架构一句话

**Next.js 15（App Router，仅用作 Route Handlers 的 HTTP 载体）+ TypeScript（strict）+ PostgreSQL 16 + Prisma**，
前后端只共享 `src/shared/**`（Zod schema + `z.infer` 推导的 DTO），契约独立成文（D8 解耦纪律）。

```
浏览器 ──HTTP/JSON──▶ Route Handlers(/api/**) ──▶ services ──▶ Prisma ──▶ PostgreSQL 16
                          ▲                                      └─ 仅共享 src/shared/**（Zod + DTO）
                     Zod 校验 + 统一信封
```

## 目录结构

```
community-reuse/
├─ prisma/
│  ├─ schema.prisma                   # ★ 事实源（10 模型 / 6 enum），与 docs/schema.prisma 逐字一致
│  ├─ migrations/0001_init/migration.sql   # 手写迁移（enum/表/索引/外键 + D3 CHECK 约束）
│  ├─ migrations/0002_claim_pending_unique/migration.sql   # 部分唯一索引：同用户同物品至多一条 PENDING
│  ├─ migrations/0003_pgvector_item_embedding/migration.sql   # CREATE EXTENSION vector + ItemEmbedding（HNSW）
│  ├─ migrations/0004_item_embedding_dim_1024/migration.sql   # 列宽 1536 → 1024（换 bge-m3）
│  └─ seed.ts + seed-data.ts          # 种子脚本 + 纯数据（可单测）
├─ src/
│  ├─ app/                          # ★ 页面（App Router）
│  │  ├─ page.tsx                    # 首页：hero + 新鲜度流 + 筛选 + 分页
│  │  ├─ join/ | items/new/ | items/[id]/   # 加入 / 发布 / 详情
│  │  ├─ dashboard/ | requests/ | favorites/ | notifications/ | me/
│  │  └─ api/**/route.ts             # REST 接口（见 docs/api-contract.md）
│  ├─ components/                    # 业务组件（ui.tsx / ItemCard / FilterBar / ai / ClaimPanel…）
│  │  └─ ui/**                       # shadcn 基础组件（见「前端 · 基础组件」一节）
│  ├─ hooks/                         # useQuery 封装（use-me / use-items）
│  ├─ lib/                           # fetch 封装 + ApiError、格式化、图片压缩
│  ├─ server/
│  │  ├─ db.ts                        # PrismaClient 单例
│  │  ├─ errors.ts                    # AppError + 错误码 → HTTP 状态映射
│  │  └─ http.ts                      # 统一响应信封 {data}/{error} + Route Handler 辅助
│  └─ shared/
│     ├─ schemas.ts                   # ★ 唯一共享边界：Zod schema（契约事实源的实现）
│     └─ types.ts                     # 由 schema 推导的 DTO 类型
├─ tests/unit/**                      # Vitest 单测（零 DB 依赖）
├─ docker-compose.yml                 # 只跑 db 一个服务（build docker/db.Dockerfile = PG16 + pgvector）
├─ docker/db.Dockerfile               # pgvector 按架构取 Alpine v3.20 apk（见「数据库说明」）
├─ .github/workflows/ci.yml           # lint → typecheck → format:check → test（自建并起 PG16+pgvector 容器）
└─ .env.example                       # 环境变量样例
```

## 前端（页面与交互）

- **技术栈**：Tailwind CSS v4（CSS-first `@theme`，无 `tailwind.config`）、framer-motion（仅保留 `AnimatePresence` 出入场与两处 `layoutId` 药丸）、TanStack Query（`keepPreviousData` 分页）、react-hook-form + zodResolver（**与后端共用 `src/shared/schemas.ts`，同源校验**）、recharts（看板图表，`next/dynamic` 懒加载）、lucide-react、sonner、canvas-confetti（动态 `import()`）。组件为手写 shadcn 风格（`src/components/ui.tsx`，cva 变体），未引入 CLI。
- **页面**：`/` 今天（首页 = 需要你处理 + 刚刚上架）、`/join` 邀请码加入、`/items/new` 发布（含 AI 定价 / 润色助手、canvas WebP 图片压缩）、`/items/[id]` 详情（画廊 + 想要面板 + 公开留言板）、`/requests` 待办（申请收发）、`/favorites` 收藏、`/notifications` 通知、`/dashboard` 看板、`/me` 个人中心。
- **信息架构按「住户要做什么」分组，不按数据库实体分组**：一级导航从 5 项收成 3 项（流转 / 待办 / 我的）。原先「请求」与「通知」是同一件事（都在回答「有什么在等我」）却被拆到两处 —— 一个在导航、一个在顶栏铃铛；「发布」占着导航位但它是一个动作而不是地方；「看板」是运营视角，现从一级导航下移到「我的」。首页顶部由口号改为**小区名 + 日期**（「临风小区，今天」），因为一个讲「邻里」的产品不告诉你在哪个小区，是叙事上的自相矛盾。
- **诚实降级**：看板四项取自 `GET /api/stats/community` 的服务端聚合，前端不再用当前页数据冒充全量；两张分布图仍按已加载页聚合，标题即写明口径。接口调用失败一律渲染 `ErrorPanel` + 重试，**不用 `.catch(() => [])` 把「没读到」下沉成「没有数据」**——那会对确实有内容的用户报假事实。这条纪律由 `src/hooks/use-failure.ts` 的 `failureOf()` 收成单一实现，并由 `tests/unit/ui/three-states.test.tsx` 在三个页面上并排守住（上一版三处破法完全一致：首页显示「没有匹配的物品」、请求页显示「暂无请求」、个人中心显示「会话已过期」并把用户引向错误的补救动作）。
- **校验**：`npm run lint` → `npm run typecheck` → `npm run test` → `npm run build` 全绿。

### 基础组件（shadcn 风格）

`src/components/ui/**` 是 Radix + `cva` 的基础组件集（`components.json` 声明，非 CLI 生成），已实际接线：

- `TooltipProvider` —— 根布局（`src/app/layout.tsx`）包裹全站；
- `Sheet` —— 移动端把筛选项收进底部抽屉（`FilterBar`，设计文档 §6.2）；
- `DropdownMenu` + `Avatar` —— AppShell 用户菜单（个人中心 / 通知 / 退出登录）；
- `Toaster`（sonner）—— 与 `Providers` 里的 toast 出口一致。

其语义 token（`--color-primary` / `--color-background` / `--color-border` / `--radius` 等）与 `tw-animate-css` 的出入场动画类均在 `src/app/globals.css` 定义，取值对齐 `docs/frontend-design-system.md` §3。`cn` 统一在 `src/lib/utils.ts`（`clsx + tailwind-merge`）。业务页面仍以单文件 `src/components/ui.tsx`（Button / Card / Badge…）为主，`ui/**` 作为通用扩展。

> ⚠️ Next.js 15 的 dev 与 build 共用 `.next`：**跑 `npm run build` 前先停掉 `npm run dev`**，否则会出现 `routes-manifest.json` 缺失类报错；遇到时 `Remove-Item -Recurse -Force .next` 后重来即可。

## 环境要求

- **Node 22.x**（见 `.nvmrc`；`package.json` 的 `engines.node` 为 `>=22 <23`）
- **npm**（本工程只用 npm，不引入 pnpm / bun）
- **Docker**（仅用于起一个 PostgreSQL 16 容器）

## 快速开始

```bash
# 1) 安装依赖
npm install

# 2) 准备环境变量
cp .env.example .env
# 主路径需要真 Key：`.env.example` 的 LLM_API_KEY 是空串，空则三接口一律
# `degraded:true / source:'rule'`（能跑，但演示的是降级态而非 LLM 态）。
# 语义检索另配 EMBEDDING_*（见「AI 环境变量」一节），不配则检索工具自动摘除、定价仍走聚合行情。

# 3) 起 PostgreSQL 16 + pgvector（单个容器；compose 会 build docker/db.Dockerfile）
npm run db:up            # 等价于 docker compose up -d db

# 4) 应用数据库迁移（手写迁移，用 deploy 应用，不要用 migrate dev 重新生成）
#    0003 需要 pgvector：只有上一步 build 出来的镜像带扩展，直接 pull 官方
#    postgres:16-alpine 会在 `CREATE EXTENSION vector` 处报 58P01 / 0A000。
npm run prisma:deploy    # 等价于 prisma migrate deploy

# 5) 生成 Prisma Client（迁移后即可生成类型）
npm run prisma:generate

# 6) 灌入种子数据（2 个小区 / 4 个用户 / 7 件物品 / 1 条已归档成交记录）
npm run db:seed

# 7) 建会话记忆的 checkpoint 表（LangGraph 自管，故意不进 prisma/schema.prisma）
npm run ai:setup-checkpoint

# 8) 可选：为**存量**物品回填语义向量（配了 EMBEDDING_* 才有意义）
#    发布与编辑已经会自动重算（`items/route.ts` / `items/[id]/route.ts` 在写后
#    `indexAfterCommit(...)`），所以这一步只为「接线之前就在库里的物品」和
#    「换了 embedding 模型要全量重算」服务；种子数据就属于前者。
npm run db:embed

# 9) 启动开发服务器
npm run dev
open http://localhost:3000              # 页面入口（种子邀请码 LINFENG-2026）
curl -s http://localhost:3000/api/health
# => {"data":{"db":"ok","llm":false,"storage":"local"}}
```

停止数据库：`npm run db:down`。

## AI 环境变量与降级口径

三能力的可用性由 `.env` 决定，**不配 Key 也能跑**，但跑的是降级态：

| 变量                                                  | 默认                                      | 作用 / 踩过的坑                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LLM_API_KEY`                                         | 空                                        | 空 ⇒ 一律不发请求，直接规则降级（`degraded:true / source:'rule'`，HTTP 仍 200）。演示 LLM 主路径必须填。                                                                                                                                                                                                                                                                                   |
| `LLM_TIMEOUT_MS`                                      | `22000`                                   | **单轮**上限。实测带 tools 的单轮 1.7 / 15.1 / 16.2 / 20.7s（4 次里 3 次 > 15s）—— 早先样例给的是 `6000`，照它配会让定价 agent 被自己的超时稳定掐死。别调回 6s。                                                                                                                                                                                                                           |
| `LLM_DEADLINE_MS`                                     | `60000`                                   | **全局硬闸**（`budget.ts`），跨所有轮次与 REPAIR；超时 ⇒ `FALLBACK`。唯一事实源在 `budget.ts`，`gateway.ts` 不再另存一份。                                                                                                                                                                                                                                                                 |
| `AI_PRICING_PREFETCH`                                 | `1`                                       | 保险模式：模型没主动调工具时，服务端预取社区行情再问一遍。                                                                                                                                                                                                                                                                                                                                 |
| `EMBEDDING_API_KEY` / `_BASE_URL` / `_MODEL` / `_DIM` | 空 / siliconflow / `BAAI/bge-m3` / `1024` | 语义检索。无 Key ⇒ `search_similar_items` **局部摘除**，聚合行情照常、`source:'llm' degraded:false`。`_DIM` 与迁移里的列宽（0003 建表 1536 → **0004 改 1024**）**必须一致**：维度钉死在建表时，`embeddings.ts` 会按它硬校验向量长度。换模型 = 一次新迁移 + `npm run db:embed` 全量回填；另注意 pgvector 索引上限 2000 维。DeepSeek 不提供 embeddings，这把 Key 与 `LLM_API_KEY` 不能混用。 |

## 已实现接口（按阶段增量）

| 模块 | 端点                    | 权限   | 说明                                                           |
| ---- | ----------------------- | ------ | -------------------------------------------------------------- |
| 健康 | `GET /api/health`       | GUEST  | DB/LLM/存储探测                                                |
| 鉴权 | `POST /api/auth/join`   | GUEST  | 邀请码加入：建用户+成员，签发 HttpOnly 会话 Cookie             |
| 鉴权 | `POST /api/auth/switch` | MEMBER | 切换当前社区（重签 Cookie）                                    |
| 鉴权 | `POST /api/auth/logout` | —      | 清除会话 Cookie                                                |
| 身份 | `GET` / `PATCH /api/me` | MEMBER | 本人资料；`PATCH` 是 `contactText` **唯一写入口**（空串=清空） |

- 会话：**无服务端会话表**，Cookie 用 `SESSION_SECRET` 做 HMAC-SHA256 签名；**签名不通过一律视为未登录**。
- 权限：**由关系推导**（`MEMBER` / `OWNER` / `ACCEPTED_APPLICANT`），**无角色列、无 ADMIN**；越权 403、未登录 401。
- 多租户：**社区只认服务端会话**（`session.currentCommunityId`）；请求体 / 查询串里的 `communityId` 一律与会话比对，不符 403。

## 前端（阶段 0 · 基础设施）

前端按 `docs/frontend-design-system.md` 与 `docs/frontend-ui-prompts.md` 执行，基础设施部分已完成：

- Tailwind CSS v4 + PostCSS 接入；
- shadcn/ui 初始化（`components.json`、`src/components/ui/**`，并已接线到布局与交互，见上「基础组件」）；
- 全局设计 token（社区绿 / 暖琥珀 / AI 紫 / 状态色 / 卡片阴影）；
- App Router 根布局、字体、Tooltip Provider、Sonner Toaster；
- `cn` 工具函数统一为 `clsx + tailwind-merge`（`src/lib/utils.ts`）。

> 业务页面（发现流 / 详情 / 发布 / 看板等）已在「前端（页面与交互）」一节交付，本节仅记录基础设施。

## 数据库说明

- **事实源**：`docs/schema.prisma`（架构师复核通过）。`prisma/schema.prisma` 与它 **逐字一致**（用 `diff` 证明，见下）。
- **迁移为手写**：`prisma/migrations/0001_init/migration.sql`，字段/索引/外键与 schema 逐条对应，
  并额外写入 D3 的两条 CHECK 约束：
  - `CHECK ("price" IS NULL OR "price" >= 0)` —— 价格非负；
  - `CHECK ("tradeType" <> 'FIXED_PRICE' OR "price" IS NOT NULL)` —— 固定价必填价格。
    （§4.4 表中「图片 ≤6 张 / 类型 / 单张大小」属**应用层**校验，且跨行计数无法用普通 CHECK 表达。）
- **迁移 0002**：`prisma/migrations/0002_claim_pending_unique/migration.sql` 手写**部分唯一索引**
  `ClaimRequest_itemId_applicantId_pending_key ON ("ClaimRequest")("itemId","applicantId") WHERE status='PENDING'`
  —— Prisma schema 无法表达带 `WHERE` 的部分索引，故与 0001 的 CHECK 同源手写。它只作用于有效（PENDING）申请，
  申请被拒 / 取消 / 完成后允许复投；是 `submitClaim` 应用层断言的 DB 兜底。
- **迁移 0003**：`prisma/migrations/0003_pgvector_item_embedding/migration.sql` 建 `CREATE EXTENSION vector` +
  `ItemEmbedding`（HNSW `vector_cosine_ops` + `communityId` 索引）。两条口径：
  - **列宽钉死在迁移里**（0003 建的是 `vector(1536)`），运行时的 `EMBEDDING_DIM` 不参与建表 —— 维度若可变，
    换模型就会「写入一维、查询另一维」静默错位；把它变成一次显式的「新迁移 + 全量回填」成本。
  - `vector` 在 Prisma 里是 `Unsupported("vector(...)")`，**Client 读写不了该列**，写路径只有 raw SQL。
- **迁移 0004**：`prisma/migrations/0004_item_embedding_dim_1024/migration.sql` 把列宽改成 `vector(1024)`
  —— 嵌入模型从 `text-embedding-3-small` 换成 **bge-m3**（多语言、中文强，1024 维，远低于 pgvector 的
  2000 维索引上限）。做法是「删列 + 重建 + 重建 HNSW 索引」而非 `ALTER TYPE`：pgvector 没有 1536→1024 的
  截断 cast。删列前先 `DELETE FROM "ItemEmbedding"` 是**语义正确**的动作，不是丢数据：不同模型的向量不在
  同一个语义空间里，留着等于让近邻检索算出无意义的距离。三件配套事缺一即静默失败：本迁移、`EMBEDDING_DIM=1024`、`npm run db:embed`。
- **pgvector 怎么来的（换机器必读）**：`postgres:16-alpine` 不含该扩展，`pgvector/pgvector:pg16` 在本机又拉不动
  （Docker Hub 被 DNS 污染）。最终路径是 `docker/db.Dockerfile` 装 **Alpine v3.20 归档仓库**针对 PG16 预编译的
  `postgresql-pgvector` apk，按 `pg_config` 的实际目录安放。**必须按架构取包**：该仓库同时有 `x86_64` 与 `aarch64`
  两支，早先只钉 x86_64，Apple Silicon 上**构建照样成功**（文件都在），直到 `CREATE EXTENSION vector` 才炸
  `unsupported relocation type 6`（58P01）。现在 Dockerfile 按 `TARGETARCH` 选包，并在构建期比对 `vector.so` 与
  PG 二进制的 ELF `e_machine`——只查文件存在性不足以拦住架构错位。基镜像 `TZ: UTC` 不能丢（§4.3② 时钟源不变量）。
- 之所以手写而非 `prisma migrate dev` 生成：沙箱内该命令会被 SIGKILL；迁移已是**定稿 SQL**，
  在真实 PG 上用 `npm run prisma:deploy` 应用即可（**不要**再用 `migrate dev` 重新生成，否则会与 schema 漂移）。
  本轮已在 **PostgreSQL 16.14** 上实际应用并验证（10 表 / 6 枚举 / 2 CHECK 全部落地，见下「集成测试」）。
- 校验一致性：

  ```bash
  diff docs/schema.prisma prisma/schema.prisma   # 无输出 = 逐字一致
  npm run test                                   # 其中一项单测即断言二者逐字相等
  ```

> **端口提示**：`docker-compose.yml` 的宿主机端口可用环境变量 `DB_PORT` 覆盖（默认 `5432`）。
> 若本机 5432 已被其它程序占用，在本地 `.env` 设 `DB_PORT=55433` 并同步改 `DATABASE_URL` 端口即可。

## 工程规范

| 项         | 落地                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`；路径别名 `@/*` → `src/*`                                                                                                                                                                                                                                                                                                     |
| Lint       | ESLint **flat config**（`eslint.config.mjs`）：`next/core-web-vitals` + `next/typescript`；禁用 `any` 与未使用变量；`no-restricted-imports` 守卫 D8 解耦                                                                                                                                                                                                                                                                  |
| Format     | Prettier + `.editorconfig`（2 空格 / LF / utf-8）                                                                                                                                                                                                                                                                                                                                                                         |
| 测试       | Vitest：单测 `tests/unit/**`（`npm run test`）；集成 `tests/integration/**`（真连库，`RUN_INTEGRATION=1` 门控）；coverage：`npm run test:coverage`                                                                                                                                                                                                                                                                        |
| 提交       | Conventional Commits（`commitlint`）+ husky（`commit-msg`）+ lint-staged（`pre-commit`：lint + typecheck）                                                                                                                                                                                                                                                                                                                |
| CI         | `.github/workflows/ci.yml`：`npm ci` → lint → typecheck → format:check → test → deploy → seed → checkpoint → 集成测试。数据库不用 `services:` 声明而是首个 step 里 `docker build docker/db.Dockerfile` + `docker run`：`jobs.<id>.services` **不支持 `build` 键**（只有 `container` 支持），误写会让工作流在校验阶段就失败、连一个 job 都不生成。镜像必须含 pgvector，否则迁移 0003 的 `CREATE EXTENSION vector` 报 P3018 |
| 容器       | `docker-compose.yml` 只有 `db` 一个服务                                                                                                                                                                                                                                                                                                                                                                                   |

## 测试与本地检查

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test          # Vitest 单测（tests/unit/**，零 DB 依赖 —— 没起库也不会红）
npm run test:integration  # Vitest 集成测试（真连库；需 PG 在跑，见下）
npm run test:coverage # 覆盖率门禁（CI 里跑，阈值见 vitest.config.ts）
npm run format:check  # Prettier 校验
npm run format        # 自动格式化
```

### 前端单测（`tests/unit/ui/**`，jsdom）

UI 层**不再是「结构上无法测试」**的状态。上一版 `vitest.config.ts` 的 coverage
`include` 只收 `src/**/*.ts`，把所有 `.tsx` 排除在外，且没有 DOM 环境 ——
9 个页面 + 16 个组件的覆盖率恒为 0%。现在：

- `environmentMatchGlobs` 把 `tests/unit/ui/**` 与 `tests/unit/seed-assets.test.ts`
  切到 jsdom，其余仍是 node。
- `esbuild: { jsx: 'automatic' }` —— Next 的 tsconfig 用 `jsx: preserve`，
  不显式指定的话 esbuild 会退回经典 `React.createElement`，每个 `.tsx` 测试都得
  手写 `import React`。

已覆盖的几条**回归**（每一条都对应一个真实缺陷，不是为了凑覆盖率）：

| 测试                         | 守住什么                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/field.test.tsx`          | `Field` 的 `label` 必须与控件程序化关联。改之前浏览器实测 `labels[].htmlFor === ""` 且 `inputs[].id === ""` —— 全站每个输入框对读屏都是无名称的。                            |
| `ui/three-states.test.tsx`   | 「读不到 ≠ 没有」。`/me` 上一版把**任何**失败都显示成「会话 Cookie 已过期」，服务端 500 也会引导用户去重新加入。                                                             |
| `ui/home-page.test.tsx`      | 首页三态 + 新增的「需要你处理」区块。                                                                                                                                        |
| `ui/failure.test.tsx`        | `failureOf()` 的分类，含「403 不得被当成未登录」这条容易搞混的边界。                                                                                                         |
| `ui/item-card.test.tsx`      | 图片 404 时降级为占位。**顺带纠正上一轮报告里「`<img onError>` 在 React 里不生效」的错误结论** —— 它生效，测试把真实行为钉住了。                                             |
| `cn.test.ts`                 | 主按钮文字曾经**完全不可见**：自定义刻度 `text-ink-inverse`（颜色）被同组的 `text-base-app`（字号）静默覆盖，tailwind-merge 只认官方刻度。断言里带真实对比度计算（≥4.5:1）。 |
| `seed-assets.test.ts`        | 种子数据引用的 7 张图必须真的落盘。`public/uploads/*` 被 gitignore，`db:seed` 上一版只写库不写文件，于是**整个演示网格是六块灰**。                                           |
| `ui/read-pages.test.tsx`     | 看板 / 收藏 / 通知的三态。看板聚合失败时数字位必须是「—」而不是 0；「全部已读」串行逐条、不重复打已读的。                                                                    |
| `ui/item-detail.test.tsx`    | 详情页 + ClaimPanel + MessageBoard：权限分支（`viewer` 四个布尔量）、D1 隐私硬规则（详情页永不出现联系方式）、发布者视角申请列表失败时必须说「无法判断」而不是「没人要」。   |
| `ui/publish.test.tsx`        | 发布表单的校验对读屏可见（`aria-invalid` + `aria-describedby`）、标价必须有价格的跨字段规则。**这组抓到一个真 bug**，见下。                                                  |
| `ui/shell-and-join.test.tsx` | 加入流程回答住户的三个问题（为什么/从哪拿/安不安全）且无开发者术语；导航收拢成 3 项；搜索防抖的「显示值 vs 生效值」分离。                                                    |

### 补 UI 测试时抓到的 bug：`标价` 那一栏

`price` 原本写 `z.number()` 配 `register('price', { valueAsNumber: true })`。
看着自然，实际有两个后果：

1. **空输入得到 `NaN`，不是 `undefined`。** 而 `NaN === null` 与 `NaN === undefined`
   都是 `false`，所以 `superRefine` 里那句「标价交易必须填写价格」**永远不会触发**，
   是一句死代码。
2. **用户看到的是 Zod 的英文原文。** `NaN` 被 `z.number()` 拦下并报
   `Expected number, received nan` —— 在中文表单上，选了「标价」却不填价格，
   浮出来的是这一句英文。

改成收字符串（空串就是明确的「没填」），数字转换推迟到 submit，顺带消掉了
`values.price ?? null` 在 `NaN` 时原样透传、导致「标价 0 元」与「没填价格」混淆的问题。
浏览器实测已确认：现在显示的是「标价交易必须填写价格」。

> 这个 bug 在补测试之前**一直存在且没被发现** —— 页面截图里看不出问题，
> 要真的点「标价」再提交才会暴露。这正是 UI 层从结构性 0% 覆盖变成有测试的收益。

### jsdom 下的两个坑

- **`canvas-confetti` 必须 mock**。`burst()` 在「发布成功 / 接受申请」这些成功路径里
  被调用，而它在浏览器里要 `getContext('2d')` —— jsdom 没有 2D 上下文，抛
  `TypeError: Cannot read properties of null (reading 'clearRect')`。这个错误发生在
  `requestAnimationFrame` 回调里，也就是**测试结束之后**：不影响任何断言，但 vitest
  会记成 `Errors 1 error` 并以 exit 1 结束，CI 直接红。症状是「测试全绿但流水线失败」，
  且 vitest 自己会提示错误"originated in ..."，很容易误判成 flaky。
  mock 掉是合理的：彩带是纯装饰，不承载任何可断言的行为。
- **块注释里不能出现 `**/`**。写「`src/**/*.ts`」这种 glob 到 `/* */` 注释里会提前闭合，
  esbuild 报 `Unexpected "*"`。同理 `cn` 的测试里别写 `*.test.*`。

### 集成测试（真连库）

`tests/integration/**` 直连 PostgreSQL（用 `pg` 驱动），断言的是 **DB 层真实行为**，
按环境变量 **门控**：默认 `npm run test` **不加载**它，因此没起库时不会变红；只有
`RUN_INTEGRATION=1`（即 `npm run test:integration`）时才运行。前置：已 `db:up` + `prisma:deploy` +（可选）`db:seed`；
`retrieve-tenant` 组要求库里装了 pgvector，缺扩展时**整组 skip 并打印原因**（「测试没跑」不等于「测试通过」）。

覆盖内容：

- **迁移结构**：10 表 / 6 枚举 / 2 条 CHECK / Item 三组复合索引确实落在 PG。
- **D3 兜底（CHECK）**：`price = -1` 被 `Item_price_non_negative_check` 拒绝；
  `FIXED_PRICE` 且 `price IS NULL` 被 `Item_fixed_price_requires_price_check` 拒绝（断言 `err.code='23514'` + 约束名）。
- **D3 兜底（唯一）**：`Favorite(userId,itemId)`、`AiCache.inputHash` 重复写入报 `23505` 并断言约束名。
- **D2 索引命中**：`EXPLAIN` 默认流查询 `(communityId,status,publishedAt)` 走
  `Item_communityId_status_publishedAt_idx`（Index Scan）。
- **§6.5 定价 SQL**：seed 反查归档成交数据（`status='ARCHIVED' AND price IS NOT NULL` ≥ 1 条）、
  `percentile_cont` 算 median、指纹聚合与样本查询可用。
- **§6.5.6 语义检索的租户谓词**（`retrieve-tenant`）：真在 pgvector 上跑向量 SQL，断言「先按 `communityId`
  过滤、再按距离排序」，且 A 社区的结果不会进 B 社区的 prompt。嵌入侧注入确定性假 provider，**不需要** `EMBEDDING_*`。
- **§6.6 会话记忆**（`ai-memory`）：真 `PostgresSaver` 落库，同 thread 二次调用看得见首轮、跨 thread 互不可见、
  `checkpoints` 表确有行。
- **§6.5.9 索引写路径**（`items-embedding`）：从路由层打到 `ItemEmbedding` 表 —— 发布即建向量、改文案推进
  `contentHash`、语料未变不白烧一次嵌入、嵌入服务挂掉发布仍 201。同样用确定性假 provider，不需要 Key。
  （这条曾是空档：`indexAfterCommit` 有实现却零调用方，而离线桩函数不接参数，所以照不出来。）
- **AI 缓存与三接口端到端**（`ai-cache` / `pricing-query` / `settlement-tool`）：L2 命中后**不再调模型**
  （用 fetch 计数当证据）、无 Key 三接口恒 200 + 四字段齐备、FAQ 跨社区 404。

```bash
npm run db:up && npm run prisma:deploy && npm run prisma:generate && npm run db:seed
npm run ai:setup-checkpoint   # LangGraph 自管的 checkpoint 表，幂等
npm run test:integration   # 22 files / 197 passed（本机 arm64 实测）
```

## 设计文档索引（`docs/`，本轮**只读**）

| 文件                            | 作用                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `docs/tech-design-final.md`     | 定稿技术方案（选型 / 架构 / 数据模型 / 排期 / 任务列表 / 依赖清单） |
| `docs/schema.prisma`            | ★ 数据模型事实源（10 模型 / 6 enum）                                |
| `docs/api-contract.md`          | ★ REST 契约事实源（含 §10 契约与实现的边界规则，即 D8 硬约束）      |
| `docs/er-diagram-final.mermaid` | 考试交付 ER 图                                                      |

## 已知限制

1. **限流状态仅存进程内**（`src/server/rate-limit.ts`）：AI 与上传的令牌桶是内存 `Map`，**多实例部署不共享**。本项目为单进程 Demo，够用；生产需换 Redis 等共享计数。进程内 `Map` 已按 `maxTrackedUsers`（缺省 5 万）做近似 LRU 淘汰，因此常驻内存不随「出现过的 userId 总数」增长。
2. **会话令牌无服务端吊销**（`src/server/auth/session.ts`）：无会话表 ⇒ 登出只能清 Cookie，无法让一个**已被复制走的令牌**立即失效。已在令牌载荷里签入 `exp`（30 天）使其必然过期，但 30 天窗口内复制品仍可用；需要「登出即失效」就得引入服务端会话表或黑名单。
3. **AI 工具超时无法取消底层查询**（`src/server/ai/tools.ts` 的 `withTimeout`）：`Promise.race` 只是放弃等待，PG 侧 SQL 仍会跑完并继续占用连接池（Prisma 5 的 `$queryRaw` 不接受 `AbortSignal`）。已把超时值收紧到 1.5s 压缩暴露窗口；根治需把这几个查询改走 `pg` 驱动（`query_timeout`）或给连接串加 `statement_timeout`。
4. **上传按 `Content-Type` 判定类型**（`src/server/storage/index.ts`）：未校验文件 magic bytes，伪造 `image/jpeg` 头可上传任意字节。本地演示可接受，生产需补内容嗅探。
5. **图片落盘 `public/uploads`**：由 Next.js 静态托管，`output: 'standalone'` / 独立 CDN 部署下需改用对象存储（`StorageAdapter` 已留扩展点，换实现即可）。
6. **`npm run build` 前先停 `npm run dev`**：Next.js 15 的 dev 与 build 共用 `.next`，否则会出现 `routes-manifest.json` 缺失类报错；遇到时删除 `.next` 重来。
7. **Node 版本**：`engines` 要求 `>=22 <23`；用更新的 Node（如 24）运行会报 `EBADENGINE` 警告，功能不受影响。
8. **语义索引是尽力而为**（`src/server/ai/index-pipeline.ts`）：发布 / 编辑后走 `indexAfterCommit` **fire-and-forget**，不 await、不抛、失败只留一行 `[ai.index]` warn —— 这是刻意的（§6.5.9：嵌入服务挂了不许把发布主路径拖下水）。副作用是「检索没结果」有两种成因：从没索引过（没配 `EMBEDDING_*`、或物品早于接线）与索引失败，二者都不报错。排障先看 `[ai.index]` 日志，再考虑 `npm run db:embed` 全量补。归档**不删**向量：归档物品正是价格锚点来源。
9. **dev 下保存文件会卡住正在进行的请求**（`next dev` 固有行为，非 bug）：任何 `src/**` 变更都会触发 4-5 个编译器依次重建，**累计约 3.9 秒**工作量，期间进来的请求排队等待。实测影响：多人/多会话共用一个工作目录时，一方保存会让另一方的导航随机停顿 **1.5-4.7 秒**；无人改动时导航稳定在 153-452ms（16 次采样 0 停顿），有人改动时 12 次采样 2 次停顿（2116ms、4678ms）。**这不是前端性能问题**——同场景下打字 `keydown → 绘制` 中位 13ms、帧间隔中位 6ms、0 长任务；耗时全在服务端 TTFB（首次访问某页 1.8-6.1s，客户端仅占 174-1757ms）。生产 `next start` 无此环节：导航 35-69ms、按钮 11-17ms、0 长任务，**ms 级要求以生产为准**。要消除该停顿只能隔离工作副本（如 `git worktree` 各起各的 dev server）。

> 历史沙箱限制（Prisma CLI 被 SIGKILL、Docker 未运行、仅实现 health）均已解除：迁移 0001–0003 已在 **PostgreSQL 16 + pgvector** 上 `prisma:deploy` 落地，`tests/integration/**` 真连库 **197 项全绿（22 个文件）**，25 个 Route Handler 全部实现。
