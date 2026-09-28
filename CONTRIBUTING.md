# 贡献指南（CONTRIBUTING）

## 分支

- `main`：可交付分支，受保护。
- 功能分支：`feat/<topic>`、修复分支：`fix/<topic>`。
- 一个 PR 只做一件事，尽量小步、可回滚。

## 提交规范（Conventional Commits，由 `commitlint` 强制）

格式：`<type>(<scope>)?: <subject>`

- `type`：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `build` / `ci` / `perf` / `style`
- `scope`（可选）：`api` / `server` / `shared` / `prisma` / `ci` / `docs` …
- 示例：
  - `feat(api): 新增 GET /api/items 列表接口`
  - `fix(server): 修正错误码到 HTTP 状态的映射`
  - `chore(ci): CI 增加 format:check 步骤`

提交时会自动运行：

- `commit-msg` 钩子：`commitlint` 校验提交信息；
- `pre-commit` 钩子：`lint-staged`（对暂存文件跑 `eslint --fix` + `prettier --write`）**并**执行 `npm run typecheck`。

## 本地检查（提交前请自行跑一遍）

```bash
npm run lint
npm run typecheck
npm run test
npm run format:check
```

## PR 流程

1. 从 `main` 切出功能分支；
2. 完成改动，补齐/更新单测（`tests/unit/**`）；
3. 本地四条检查全绿；
4. 提 PR，描述：改了什么、为什么、如何验证（贴命令与结果）；
5. 至少一位评审通过后合并；
6. 合并策略：squash（保持 `main` 历史线性、提交信息符合 Conventional Commits）。

## 硬约束（评审必看）

1. `prisma/schema.prisma` 必须与 `docs/schema.prisma` **逐字一致**（改模型先改文档，再同步两处）。
2. 后端（`src/server/**`、`src/app/api/**`）**禁止** import 前端组件 / 页面 / hooks / lib（D8 解耦，ESLint 已兜底）。
3. 不引入 `langchain` / `langgraph` / `@langchain/core` 或任何 LLM 框架。
4. 接口变更顺序：先改 `docs/api-contract.md` → 再改 `src/shared/schemas.ts` → 最后各自实现。
5. 不提交 `.env`；本地图片落盘目录 `public/uploads/*` 不入库（保留 `.gitkeep`）。
