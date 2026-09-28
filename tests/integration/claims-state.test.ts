/**
 * 领取申请**状态机**的真连库路由测试（契约 §4 · 设计 §4.1）。
 *
 * 覆盖 team-lead T-BE-05 §4/§5 的硬要求：
 *   - `accept` 四步全套：申请 `ACCEPTED`+`acceptedAt`、物品 `RESERVED`+`reservedAt`、
 *     同物品其他 `PENDING` 全变 `REJECTED`、`CLAIM_ACCEPTED` / `CLAIM_REJECTED` 通知。
 *   - **并发**：两个 `accept` 并发打同一物品 → 恰一个 200、一个 409，最终只有一条 `ACCEPTED`。
 *   - `ACCEPTED → CANCELED`（申请人）/ `ACCEPTED → REJECTED`（owner）**都必须释放物品**（回 `ACTIVE`、`reservedAt=null`）。
 *   - `complete`：申请 `COMPLETED`+`completedAt`、物品 `ARCHIVED`+`archivedAt`（应用时钟）、`CLAIM_COMPLETED` 通知。
 *   - 非法转移全 409；越权 403；跨社区 404。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as acceptPOST } from '@/app/api/claims/[id]/accept/route';
import { POST as cancelPOST } from '@/app/api/claims/[id]/cancel/route';
import { POST as completePOST } from '@/app/api/claims/[id]/complete/route';
import { POST as rejectPOST } from '@/app/api/claims/[id]/reject/route';
import { prisma } from '@/server/db';
import { ClaimDtoSchema } from '@/shared/schemas';
import type { ClaimDto } from '@/shared/types';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  insertClaim,
  insertItem,
  mintSessionToken,
} from './helpers/db';
import { makeRequest } from './helpers/http';

interface DataEnvelope<T> {
  data: T;
}

function claimRequest(claimId: string, token: string): Request {
  return makeRequest('POST', `/api/claims/${claimId}`, { token });
}

describe('领取申请状态机（真连库）', () => {
  const scope = 'claims-state';
  let fx: TenantFixtures;
  let ownerToken: string;
  let dualToken: string;

  const items = {
    multi: '',
    race: '',
    cancelAccepted: '',
    rejectAccepted: '',
    complete: '',
    pendingComplete: '',
    completed: '',
    rejected: '',
    canceled: '',
    authz: '',
    cross: '',
  };
  const claims = {
    multiDual: '',
    multiStranger: '',
    raceDual: '',
    raceStranger: '',
    cancelAcceptedDual: '',
    rejectAcceptedDual: '',
    completeDual: '',
    pendingCompleteDual: '',
    completedDual: '',
    rejectedDual: '',
    canceledDual: '',
    authzStranger: '',
    crossDual: '',
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    dualToken = mintSessionToken(fx.dualId, fx.communityAId);

    const A = fx.communityAId;
    const O = fx.ownerId;
    const D = fx.dualId;
    const S = fx.strangerId;

    const fresh = (key: string, name: string) =>
      insertItem(scope, { key, communityId: A, ownerId: O, name });

    items.multi = await fresh('multi', '多申请物品');
    items.race = await fresh('race', '并发物品');
    items.cancelAccepted = await fresh('cancelAccepted', '已接受可取消');
    items.rejectAccepted = await fresh('rejectAccepted', '已接受可拒绝');
    items.complete = await fresh('complete', '待完成');
    items.pendingComplete = await fresh('pendingComplete', '待处理不可完成');
    items.completed = await fresh('completed', '已完成');
    items.rejected = await fresh('rejected', '已拒绝');
    items.canceled = await fresh('canceled', '已取消');
    items.authz = await fresh('authz', '越权目标');
    items.cross = await insertItem(scope, {
      key: 'cross',
      communityId: fx.communityBId,
      ownerId: D,
      name: '乙区物品',
    });

    claims.multiDual = await insertClaim(scope, {
      key: 'multiDual',
      itemId: items.multi,
      applicantId: D,
    });
    claims.multiStranger = await insertClaim(scope, {
      key: 'multiStranger',
      itemId: items.multi,
      applicantId: S,
    });
    claims.raceDual = await insertClaim(scope, {
      key: 'raceDual',
      itemId: items.race,
      applicantId: D,
    });
    claims.raceStranger = await insertClaim(scope, {
      key: 'raceStranger',
      itemId: items.race,
      applicantId: S,
    });
    claims.cancelAcceptedDual = await insertClaim(scope, {
      key: 'cancelAcceptedDual',
      itemId: items.cancelAccepted,
      applicantId: D,
    });
    claims.rejectAcceptedDual = await insertClaim(scope, {
      key: 'rejectAcceptedDual',
      itemId: items.rejectAccepted,
      applicantId: D,
    });
    claims.completeDual = await insertClaim(scope, {
      key: 'completeDual',
      itemId: items.complete,
      applicantId: D,
    });
    claims.pendingCompleteDual = await insertClaim(scope, {
      key: 'pendingCompleteDual',
      itemId: items.pendingComplete,
      applicantId: D,
    });
    claims.completedDual = await insertClaim(scope, {
      key: 'completedDual',
      itemId: items.completed,
      applicantId: D,
    });
    claims.rejectedDual = await insertClaim(scope, {
      key: 'rejectedDual',
      itemId: items.rejected,
      applicantId: D,
    });
    claims.canceledDual = await insertClaim(scope, {
      key: 'canceledDual',
      itemId: items.canceled,
      applicantId: D,
    });
    claims.authzStranger = await insertClaim(scope, {
      key: 'authzStranger',
      itemId: items.authz,
      applicantId: S,
    });
    claims.crossDual = await insertClaim(scope, {
      key: 'crossDual',
      itemId: items.cross,
      applicantId: D,
    });
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  const readItem = (id: string) =>
    prisma.item.findUnique({
      where: { id },
      select: { status: true, reservedAt: true, archivedAt: true },
    });
  const readClaim = (id: string) =>
    prisma.claimRequest.findUnique({
      where: { id },
      select: { status: true, acceptedAt: true, completedAt: true },
    });

  // ---------------------------------------------------------------------------
  // accept：单事务四步
  // ---------------------------------------------------------------------------
  describe('accept（单事务四步）', () => {
    it('200：申请 ACCEPTED+acceptedAt、物品 RESERVED+reservedAt、其他 PENDING 全 REJECTED、双方通知齐全', async () => {
      const acceptedBefore = await prisma.notification.count({
        where: { userId: fx.dualId, type: 'CLAIM_ACCEPTED' },
      });

      const response = await acceptPOST(claimRequest(claims.multiDual, ownerToken), {
        params: { id: claims.multiDual },
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ClaimDto>;
      expect(() => ClaimDtoSchema.parse(json.data)).not.toThrow();
      expect(json.data.status).toBe('ACCEPTED');
      expect(json.data.acceptedAt).not.toBeNull();

      const accepted = await readClaim(claims.multiDual);
      expect(accepted?.status).toBe('ACCEPTED');
      expect(accepted?.acceptedAt).not.toBeNull();

      const item = await readItem(items.multi);
      expect(item?.status).toBe('RESERVED');
      expect(item?.reservedAt).not.toBeNull();

      const displaced = await readClaim(claims.multiStranger);
      expect(displaced?.status).toBe('REJECTED');

      expect(
        await prisma.notification.count({ where: { userId: fx.dualId, type: 'CLAIM_ACCEPTED' } }),
      ).toBe(acceptedBefore + 1);
      expect(
        await prisma.notification.count({
          where: { userId: fx.strangerId, type: 'CLAIM_REJECTED' },
        }),
      ).toBeGreaterThan(0);
    });

    it('并发：两个 accept 打同一物品 → 恰一个 200、一个 409，最终只有一条 ACCEPTED', async () => {
      const [r1, r2] = await Promise.all([
        acceptPOST(claimRequest(claims.raceDual, ownerToken), { params: { id: claims.raceDual } }),
        acceptPOST(claimRequest(claims.raceStranger, ownerToken), {
          params: { id: claims.raceStranger },
        }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);

      const acceptedCount = await prisma.claimRequest.count({
        where: { itemId: items.race, status: 'ACCEPTED' },
      });
      expect(acceptedCount).toBe(1);

      const item = await readItem(items.race);
      expect(item?.status).toBe('RESERVED');
    });
  });

  // ---------------------------------------------------------------------------
  // 已接受后的释放路径（§4.1 明确画出，最易漏）
  // ---------------------------------------------------------------------------
  describe('ACCEPTED 之后的释放路径', () => {
    it('accept 后 applicant cancel → 申请 CANCELED 且物品回到 ACTIVE、reservedAt=null', async () => {
      const accepted = await acceptPOST(claimRequest(claims.cancelAcceptedDual, ownerToken), {
        params: { id: claims.cancelAcceptedDual },
      });
      expect(accepted.status).toBe(200);
      expect((await readItem(items.cancelAccepted))?.status).toBe('RESERVED');

      const cancelled = await cancelPOST(claimRequest(claims.cancelAcceptedDual, dualToken), {
        params: { id: claims.cancelAcceptedDual },
      });
      expect(cancelled.status).toBe(200);
      const json = (await cancelled.json()) as DataEnvelope<ClaimDto>;
      expect(json.data.status).toBe('CANCELED');

      const item = await readItem(items.cancelAccepted);
      expect(item?.status).toBe('ACTIVE');
      expect(item?.reservedAt).toBeNull();
    });

    it('accept 后 owner reject → 申请 REJECTED 且物品回到 ACTIVE、reservedAt=null', async () => {
      const accepted = await acceptPOST(claimRequest(claims.rejectAcceptedDual, ownerToken), {
        params: { id: claims.rejectAcceptedDual },
      });
      expect(accepted.status).toBe(200);
      expect((await readItem(items.rejectAccepted))?.status).toBe('RESERVED');

      const rejected = await rejectPOST(claimRequest(claims.rejectAcceptedDual, ownerToken), {
        params: { id: claims.rejectAcceptedDual },
      });
      expect(rejected.status).toBe(200);
      const json = (await rejected.json()) as DataEnvelope<ClaimDto>;
      expect(json.data.status).toBe('REJECTED');

      const item = await readItem(items.rejectAccepted);
      expect(item?.status).toBe('ACTIVE');
      expect(item?.reservedAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------
  describe('complete', () => {
    it('200：申请 COMPLETED+completedAt、物品 ARCHIVED+archivedAt（应用时钟）、申请人收到 CLAIM_COMPLETED', async () => {
      const accepted = await acceptPOST(claimRequest(claims.completeDual, ownerToken), {
        params: { id: claims.completeDual },
      });
      expect(accepted.status).toBe(200);
      expect((await readItem(items.complete))?.status).toBe('RESERVED');

      const before = Date.now();
      const completed = await completePOST(claimRequest(claims.completeDual, ownerToken), {
        params: { id: claims.completeDual },
      });
      expect(completed.status).toBe(200);
      const json = (await completed.json()) as DataEnvelope<ClaimDto>;
      expect(json.data.status).toBe('COMPLETED');
      expect(json.data.completedAt).not.toBeNull();

      const claim = await readClaim(claims.completeDual);
      expect(claim?.status).toBe('COMPLETED');
      expect(claim?.completedAt).not.toBeNull();

      const item = await readItem(items.complete);
      expect(item?.status).toBe('ARCHIVED');
      expect(item?.archivedAt).toBeInstanceOf(Date);
      // 应用时钟写入：落在调用前后 60s 内（经 Prisma 读取，避免 pg 的 timestamp 时区解析）
      expect(Math.abs((item?.archivedAt as Date).getTime() - before)).toBeLessThan(60_000);

      expect(
        await prisma.notification.count({ where: { userId: fx.dualId, type: 'CLAIM_COMPLETED' } }),
      ).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 非法转移 → 409
  // ---------------------------------------------------------------------------
  describe('非法转移 → 409 CLAIM_CONFLICT', () => {
    it('PENDING → complete → 409', async () => {
      const response = await completePOST(claimRequest(claims.pendingCompleteDual, ownerToken), {
        params: { id: claims.pendingCompleteDual },
      });
      expect(response.status).toBe(409);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('CLAIM_CONFLICT');
    });

    it('REJECTED → accept → 409', async () => {
      const rejected = await rejectPOST(claimRequest(claims.rejectedDual, ownerToken), {
        params: { id: claims.rejectedDual },
      });
      expect(rejected.status).toBe(200);
      expect((await readClaim(claims.rejectedDual))?.status).toBe('REJECTED');

      const response = await acceptPOST(claimRequest(claims.rejectedDual, ownerToken), {
        params: { id: claims.rejectedDual },
      });
      expect(response.status).toBe(409);
    });

    it('CANCELED → accept → 409', async () => {
      const cancelled = await cancelPOST(claimRequest(claims.canceledDual, dualToken), {
        params: { id: claims.canceledDual },
      });
      expect(cancelled.status).toBe(200);
      expect((await readClaim(claims.canceledDual))?.status).toBe('CANCELED');

      const response = await acceptPOST(claimRequest(claims.canceledDual, ownerToken), {
        params: { id: claims.canceledDual },
      });
      expect(response.status).toBe(409);
    });

    it('COMPLETED → accept / reject / cancel / complete 全 409', async () => {
      expect(
        (
          await acceptPOST(claimRequest(claims.completedDual, ownerToken), {
            params: { id: claims.completedDual },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await completePOST(claimRequest(claims.completedDual, ownerToken), {
            params: { id: claims.completedDual },
          })
        ).status,
      ).toBe(200);
      expect((await readClaim(claims.completedDual))?.status).toBe('COMPLETED');

      const acceptAgain = await acceptPOST(claimRequest(claims.completedDual, ownerToken), {
        params: { id: claims.completedDual },
      });
      const rejectAgain = await rejectPOST(claimRequest(claims.completedDual, ownerToken), {
        params: { id: claims.completedDual },
      });
      const cancelAgain = await cancelPOST(claimRequest(claims.completedDual, dualToken), {
        params: { id: claims.completedDual },
      });
      const completeAgain = await completePOST(claimRequest(claims.completedDual, ownerToken), {
        params: { id: claims.completedDual },
      });
      expect([
        acceptAgain.status,
        rejectAgain.status,
        cancelAgain.status,
        completeAgain.status,
      ]).toEqual([409, 409, 409, 409]);
    });
  });

  // ---------------------------------------------------------------------------
  // 越权 / 跨租户
  // ---------------------------------------------------------------------------
  describe('越权与跨租户', () => {
    it('非 owner 调 accept/reject/complete → 403', async () => {
      const acceptRes = await acceptPOST(claimRequest(claims.authzStranger, dualToken), {
        params: { id: claims.authzStranger },
      });
      const rejectRes = await rejectPOST(claimRequest(claims.authzStranger, dualToken), {
        params: { id: claims.authzStranger },
      });
      const completeRes = await completePOST(claimRequest(claims.authzStranger, dualToken), {
        params: { id: claims.authzStranger },
      });
      expect([acceptRes.status, rejectRes.status, completeRes.status]).toEqual([403, 403, 403]);
    });

    it('非申请人调 cancel（owner 取消他人申请）→ 403', async () => {
      const response = await cancelPOST(claimRequest(claims.authzStranger, ownerToken), {
        params: { id: claims.authzStranger },
      });
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('跨社区 claim → 404（甲区会话操作乙区物品的申请）', async () => {
      const acceptRes = await acceptPOST(claimRequest(claims.crossDual, ownerToken), {
        params: { id: claims.crossDual },
      });
      const cancelRes = await cancelPOST(claimRequest(claims.crossDual, dualToken), {
        params: { id: claims.crossDual },
      });
      expect([acceptRes.status, cancelRes.status]).toEqual([404, 404]);
    });

    it('未登录 → 401', async () => {
      const response = await acceptPOST(
        makeRequest('POST', `/api/claims/${claims.authzStranger}`),
        {
          params: { id: claims.authzStranger },
        },
      );
      expect(response.status).toBe(401);
    });
  });
});
