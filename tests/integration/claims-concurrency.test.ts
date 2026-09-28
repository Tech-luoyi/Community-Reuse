/**
 * 并发重复申请竞态回归（真连库路由测试）。
 *
 * 缺陷背景：`submitClaim` 原先的「重复检查」在事务**之外**（check-then-act），4 个并发提交可插入
 * 多条 PENDING。修复后：重复断言进入事务 + 物品行锁串行化（锁序与 accept/reject/cancel/complete 一致）。
 *
 * 为什么必须 **≥3 轮**：单轮有随机性（可能侥幸通过）。每轮 **4 个并发**用**全新物品**（0 条 PENDING 起步）
 * 才能稳定复现；断言「恰一个 201、其余 409」且 PENDING 计数 === 1。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as rejectPOST } from '@/app/api/claims/[id]/reject/route';
import { POST as claimPOST } from '@/app/api/items/[id]/claims/route';
import { prisma } from '@/server/db';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  insertItem,
  mintSessionToken,
  pool,
} from './helpers/db';
import { makeRequest } from './helpers/http';

const CONCURRENCY = 4;

/** 对同一 item、同一 applicant 并发发起 `CONCURRENCY` 个提交，返回 HTTP 状态数组。 */
async function fireConcurrentSubmits(itemId: string, token: string): Promise<number[]> {
  const requests = Array.from({ length: CONCURRENCY }, () =>
    claimPOST(
      makeRequest('POST', `/api/items/${itemId}/claims`, {
        token,
        body: { message: '并发提交' },
      }),
      { params: { id: itemId } },
    ),
  );
  const responses = await Promise.all(requests);
  return responses.map((r) => r.status);
}

async function countPending(itemId: string, applicantId: string): Promise<number> {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM "ClaimRequest"
      WHERE "itemId" = $1 AND "applicantId" = $2 AND status = 'PENDING'`,
    [itemId, applicantId],
  );
  return rows[0]?.c ?? 0;
}

describe('并发重复申请竞态（真连库）', () => {
  const scope = 'claims-conc';
  let fx: TenantFixtures;
  let ownerToken: string;
  let dualToken: string;
  const raceItems: string[] = [];
  let reservedItem = '';
  let reapplyItem = '';
  let reapplyClaimId = '';

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    dualToken = mintSessionToken(fx.dualId, fx.communityAId);

    const A = fx.communityAId;
    const O = fx.ownerId;

    for (let i = 1; i <= 3; i += 1) {
      raceItems.push(
        await insertItem(scope, {
          key: `race${i}`,
          communityId: A,
          ownerId: O,
          name: `竞态物品${i}`,
        }),
      );
    }
    reservedItem = await insertItem(scope, {
      key: 'reserved',
      communityId: A,
      ownerId: O,
      name: '已预约物品',
      status: 'RESERVED',
    });
    reapplyItem = await insertItem(scope, {
      key: 'reapply',
      communityId: A,
      ownerId: O,
      name: '可重新申请',
    });
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // 3 轮，每轮 4 个并发、全新物品。
  for (let round = 1; round <= 3; round += 1) {
    it(`第 ${round} 轮：4 个并发提交同一物品 → 恰一个 201、其余全 409，且仅 1 条 PENDING`, async () => {
      const itemId = raceItems[round - 1] as string;
      const statuses = await fireConcurrentSubmits(itemId, dualToken);

      const created = statuses.filter((s) => s === 201).length;
      const conflicts = statuses.filter((s) => s === 409).length;
      expect(created).toBe(1);
      expect(conflicts).toBe(3);
      expect(await countPending(itemId, fx.dualId)).toBe(1);
    });
  }

  it('物品已 RESERVED 时提交 → 409（事务内 ACTIVE 复校验）', async () => {
    const response = await claimPOST(
      makeRequest('POST', `/api/items/${reservedItem}/claims`, {
        token: dualToken,
        body: { message: '申请已预约物品' },
      }),
      { params: { id: reservedItem } },
    );
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('CLAIM_CONFLICT');
    expect(await countPending(reservedItem, fx.dualId)).toBe(0);
  });

  it('申请被拒后可重新申请（无 PENDING 时允许再次提交）', async () => {
    const first = await claimPOST(
      makeRequest('POST', `/api/items/${reapplyItem}/claims`, {
        token: dualToken,
        body: { message: '第一次申请' },
      }),
      { params: { id: reapplyItem } },
    );
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { data: { id: string } };
    reapplyClaimId = firstJson.data.id;

    const rejected = await rejectPOST(
      makeRequest('POST', `/api/claims/${reapplyClaimId}/reject`, { token: ownerToken }),
      { params: { id: reapplyClaimId } },
    );
    expect(rejected.status).toBe(200);
    expect(await countPending(reapplyItem, fx.dualId)).toBe(0);

    const again = await claimPOST(
      makeRequest('POST', `/api/items/${reapplyItem}/claims`, {
        token: dualToken,
        body: { message: '重新申请' },
      }),
      { params: { id: reapplyItem } },
    );
    expect(again.status).toBe(201);
    expect(await countPending(reapplyItem, fx.dualId)).toBe(1);
  });
});
