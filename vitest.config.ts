import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 集成测试按环境变量门控：
 *   · 默认（`npm run test`）：只跑 `tests/unit/**`，零 DB 依赖 —— 没起库时也【不会变红】。
 *   · 打开（`RUN_INTEGRATION=1`，见 `npm run test:integration`）：追加 `tests/integration/**`，
 *     需要可连接的 PostgreSQL（`DATABASE_URL`，或项目根 `.env`）。
 */
const runIntegration = process.env.RUN_INTEGRATION === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: runIntegration
      ? ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
      : ['tests/unit/**/*.test.ts'],
    // 并行策略**按模式分流**，不是一刀切：
    //   · 集成测试：串行。`indexes` 用例会在事务里对 "Item" 取 ACCESS EXCLUSIVE 锁，
    //     若与其它文件的写操作并行会锁等待 / 抖动。
    //   · 单元测试：并行。23 个文件、零 DB、彼此无共享状态，串行纯属白等
    //     （实测串行下 34.9s，而 tests 本身只占 5.4s，其余全是 transform/collect）。
    fileParallelism: !runIntegration,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        // 覆盖率必须是**门禁**而不是报告，否则它早晚会被无视（CI 里跑，见 ci.yml）。
        // 单元测试**不加载** `src/app/api/**/route.ts`（那是薄适配层，由集成测试覆盖），
        // 所以全局阈值必须把它们 0% 的影响算进来；业务逻辑另用 glob 单独收紧，
        // 避免「路由把全局拉低」反过来把 `src/server/**` 的标准也一起放松。
        lines: 50,
        statements: 50,
        functions: 70,
        branches: 78,
        'src/server/**': {
          lines: 60,
          statements: 60,
          functions: 80,
          branches: 82,
        },
      },
    },
  },
});
