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
    // 集成测试直连同一个 PG：indexes 用例会在事务里对 "Item" 取 ACCESS EXCLUSIVE 锁，
    // 若与其它文件的写操作并行会锁等待/抖动 —— 故按文件串行执行。
    fileParallelism: false,
    include: [
      'tests/unit/**/*.test.ts',
      ...(runIntegration ? ['tests/integration/**/*.test.ts'] : []),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
