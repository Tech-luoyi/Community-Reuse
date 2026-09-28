/**
 * `GET /api/health` —— 健康检查（GUEST 可访问）。
 *
 * 契约：docs/api-contract.md §9 → `200 { data: { db, llm, storage } }`。
 *   - `db`      ：对数据库做一次轻量探测（`SELECT 1`，带 1.5s 超时）；未起 PG 时为 `down`，但接口本身仍 200。
 *   - `llm`     ：是否配置了 `LLM_API_KEY`（**不真正调用模型**）。
 *   - `storage` ：当前图片存储适配器（本定稿只有本地实现 `local`）。
 */
import type { HealthData } from '@/shared/types';

import { prisma } from '@/server/db';
import { jsonOk, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DB_PROBE_TIMEOUT_MS = 1500;

async function probeDatabase(): Promise<HealthData['db']> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('db probe timeout')), DB_PROBE_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'down';
  }
}

function hasLlmKey(): boolean {
  const key = process.env.LLM_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

function resolveStorage(): string {
  // 定稿只有本地实现；此处返回适配器标识，供前端/运维确认落盘方式。
  return 'local';
}

export const GET = withRoute(async (): Promise<Response> => {
  const data: HealthData = {
    db: await probeDatabase(),
    llm: hasLlmKey(),
    storage: resolveStorage(),
  };
  return jsonOk(data);
});
