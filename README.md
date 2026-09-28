# 邻里流转（community-reuse）· 后端工程

> 面向 **小区 / 楼栋 / 办公室** 的闲置物品流转工具。
> 本仓库当前为 **纯后端工程**（客户本轮指令：「前端不用管，你开始做后端吧，工程规范做好」）——
> 只实现 `prisma/**`、`src/shared/**`、`src/server/**`、`src/app/api/**`、`tests/**` 与工程配置，
> **不含任何页面 / 组件 / hooks**。

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
│  └─ seed.ts + seed-data.ts          # 种子脚本 + 纯数据（可单测）
├─ src/
│  ├─ app/api/health/route.ts         # 唯一已实现的接口：GET /api/health
│  ├─ server/
│  │  ├─ db.ts                        # PrismaClient 单例
│  │  ├─ errors.ts                    # AppError + 错误码 → HTTP 状态映射
│  │  └─ http.ts                      # 统一响应信封 {data}/{error} + Route Handler 辅助
│  └─ shared/
│     ├─ schemas.ts                   # ★ 唯一共享边界：Zod schema（契约事实源的实现）
│     └─ types.ts                     # 由 schema 推导的 DTO 类型
├─ tests/unit/**                      # Vitest 单测（零 DB 依赖）
├─ docker-compose.yml                 # 只跑 db: postgres:16-alpine
├─ .github/workflows/ci.yml           # lint → typecheck → format:check → test（带 PG service container）
└─ .env.example                       # 环境变量样例
```

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

# 3) 起 PostgreSQL 16（单个容器）
npm run db:up            # 等价于 docker compose up -d db

# 4) 应用数据库迁移（手写迁移，用 deploy 应用，不要用 migrate dev 重新生成）
npm run prisma:deploy    # 等价于 prisma migrate deploy

# 5) 生成 Prisma Client（迁移后即可生成类型）
npm run prisma:generate

# 6) 灌入种子数据（2 个小区 / 4 个用户 / 7 件物品 / 1 条已归档成交记录）
npm run db:seed

# 7) 启动开发服务器（当前只有 GET /api/health）
npm run dev
curl -s http://localhost:3000/api/health
# => {"data":{"db":"ok","llm":false,"storage":"local"}}
```

停止数据库：`npm run db:down`。

## 数据库说明

- **事实源**：`docs/schema.prisma`（架构师复核通过）。`prisma/schema.prisma` 与它 **逐字一致**（用 `diff` 证明，见下）。
- **迁移为手写**：`prisma/migrations/0001_init/migration.sql`，字段/索引/外键与 schema 逐条对应，
  并额外写入 D3 的两条 CHECK 约束：
  - `CHECK ("price" IS NULL OR "price" >= 0)` —— 价格非负；
  - `CHECK ("tradeType" <> 'FIXED_PRICE' OR "price" IS NOT NULL)` —— 固定价必填价格。
    （§4.4 表中「图片 ≤6 张 / 类型 / 单张大小」属**应用层**校验，且跨行计数无法用普通 CHECK 表达。）
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

| 项         | 落地                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`；路径别名 `@/*` → `src/*`                                    |
| Lint       | ESLint **flat config**（`eslint.config.mjs`）：`next/core-web-vitals` + `next/typescript`；禁用 `any` 与未使用变量；`no-restricted-imports` 守卫 D8 解耦 |
| Format     | Prettier + `.editorconfig`（2 空格 / LF / utf-8）                                                                                                        |
| 测试       | Vitest：单测 `tests/unit/**`（`npm run test`）；集成 `tests/integration/**`（真连库，`RUN_INTEGRATION=1` 门控）；coverage：`npm run test:coverage`       |
| 提交       | Conventional Commits（`commitlint`）+ husky（`commit-msg`）+ lint-staged（`pre-commit`：lint + typecheck）                                               |
| CI         | `.github/workflows/ci.yml`：`npm ci` → lint → typecheck → format:check → test，带 PostgreSQL 16 service container                                        |
| 容器       | `docker-compose.yml` 只有 `db` 一个服务                                                                                                                  |

## 测试与本地检查

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test          # Vitest 单测（tests/unit/**，零 DB 依赖 —— 没起库也不会红）
npm run test:integration  # Vitest 集成测试（真连库；需 PG 在跑，见下）
npm run format:check  # Prettier 校验
npm run format        # 自动格式化
```

### 集成测试（真连库）

`tests/integration/**` 直连 PostgreSQL（用 `pg` 驱动），断言的是 **DB 层真实行为**，
按环境变量 **门控**：默认 `npm run test` **不加载**它，因此没起库时不会变红；只有
`RUN_INTEGRATION=1`（即 `npm run test:integration`）时才运行。前置：已 `db:up` + `prisma:deploy` +（可选）`db:seed`。

覆盖内容：

- **迁移结构**：10 表 / 6 枚举 / 2 条 CHECK / Item 三组复合索引确实落在 PG。
- **D3 兜底（CHECK）**：`price = -1` 被 `Item_price_non_negative_check` 拒绝；
  `FIXED_PRICE` 且 `price IS NULL` 被 `Item_fixed_price_requires_price_check` 拒绝（断言 `err.code='23514'` + 约束名）。
- **D3 兜底（唯一）**：`Favorite(userId,itemId)`、`AiCache.inputHash` 重复写入报 `23505` 并断言约束名。
- **D2 索引命中**：`EXPLAIN` 默认流查询 `(communityId,status,publishedAt)` 走
  `Item_communityId_status_publishedAt_idx`（Index Scan）。
- **§6.5 定价 SQL**：seed 反查归档成交数据（`status='ARCHIVED' AND price IS NOT NULL` ≥ 1 条）、
  `percentile_cont` 算 median、指纹聚合与样本查询可用。

```bash
npm run db:up && npm run prisma:deploy && npm run prisma:generate && npm run db:seed
npm run test:integration   # 20 passed
```

## 设计文档索引（`docs/`，本轮**只读**）

| 文件                            | 作用                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `docs/tech-design-final.md`     | 定稿技术方案（选型 / 架构 / 数据模型 / 排期 / 任务列表 / 依赖清单） |
| `docs/schema.prisma`            | ★ 数据模型事实源（10 模型 / 6 enum）                                |
| `docs/api-contract.md`          | ★ REST 契约事实源（含 §10 契约与实现的边界规则，即 D8 硬约束）      |
| `docs/er-diagram-final.mermaid` | 考试交付 ER 图                                                      |

## 已知限制（本轮沙箱）

1. **Prisma CLI 在沙箱会被 SIGKILL**：`npx prisma generate` / `validate` 可能失败。因此在**无 Docker / 正常环境**下需补跑：
   `npm run db:up && npm run prisma:deploy && npm run prisma:generate && npm run db:seed`。
2. **Docker 未运行**：本机未起 PostgreSQL，故 `GET /api/health` 的 `db` 字段在本机会显示 `"down"`（接口仍 200）。
   迁移 SQL 与 seed 脚本作为交付物已写好，但**未在真实 PG 上实测**。
3. 当前 `src/app/api/**` **仅实现 `health`**，其余业务接口在后续阶段交付。
