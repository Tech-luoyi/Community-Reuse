/**
 * 权限守卫（guard）真连库测试：验证「未登录 401 / 越权 403 / 跨租户不泄漏 / 社区只认会话」。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertCurrentCommunity,
  requireAcceptedApplicant,
  requireMember,
  requireOwner,
  requireUser,
} from '@/server/auth/guard';
import { createSessionToken, verifySessionToken } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { AppError, isAppError } from '@/server/errors';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
} from './helpers/db';

async function expectAppError(
  fn: () => Promise<unknown>,
  code: string,
  httpStatus: number,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(isAppError(error)).toBe(true);
    const appError = error as AppError;
    expect(appError.code).toBe(code);
    expect(appError.httpStatus).toBe(httpStatus);
    return;
  }
  throw new Error('期望抛出 AppError，但没有任何异常');
}

describe('权限守卫（关系推导，无角色列）', () => {
  const scope = 'guard';
  let fx: TenantFixtures;

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  it('未登录（无会话）→ requireUser 抛 401 UNAUTHENTICATED', async () => {
    await expectAppError(() => requireUser(null), 'UNAUTHENTICATED', 401);
  });

  it('签名篡改的 Cookie → 视为未登录（401），不得凭「userId 看起来合法」放行', async () => {
    const valid = createSessionToken({ userId: fx.ownerId, currentCommunityId: fx.communityAId });
    const tampered = `${valid}X`;
    const session = verifySessionToken(tampered);
    expect(session).toBeNull();
    await expectAppError(() => requireUser(session), 'UNAUTHENTICATED', 401);
  });

  it('会话指向已删除的用户 → 401（失败关闭）', async () => {
    await expectAppError(
      () => requireUser({ userId: `${fx.scopePrefix}ghost`, currentCommunityId: fx.communityAId }),
      'UNAUTHENTICATED',
      401,
    );
  });

  it('合法会话 → requireUser 返回带资料与当前租户的 viewer', async () => {
    const viewer = await requireUser({
      userId: fx.ownerId,
      currentCommunityId: fx.communityAId,
    });
    expect(viewer.id).toBe(fx.ownerId);
    expect(viewer.nickname).toBe('甲-发布者');
    expect(viewer.contactText).toBe('微信 owner-contact');
    expect(viewer.currentCommunityId).toBe(fx.communityAId);
  });

  it('MEMBER：当前社区的成员通过；非成员被 403', async () => {
    const ownerInA = await requireUser({
      userId: fx.ownerId,
      currentCommunityId: fx.communityAId,
    });
    await expect(requireMember(ownerInA)).resolves.toBeUndefined();

    // owner 只属于甲；把当前社区伪造成乙 → 不是乙成员 → 403
    const ownerInB = await requireUser({
      userId: fx.ownerId,
      currentCommunityId: fx.communityBId,
    });
    await expectAppError(() => requireMember(ownerInB), 'FORBIDDEN', 403);
  });

  it('双社区用户：在甲、乙都算成员（会话决定当前租户）', async () => {
    const dualInA = await requireUser({ userId: fx.dualId, currentCommunityId: fx.communityAId });
    const dualInB = await requireUser({ userId: fx.dualId, currentCommunityId: fx.communityBId });
    await expect(requireMember(dualInA)).resolves.toBeUndefined();
    await expect(requireMember(dualInB)).resolves.toBeUndefined();
  });

  it('多租户红线：assertCurrentCommunity 对非当前社区一律 403（社区只认会话）', async () => {
    const viewer = await requireUser({
      userId: fx.ownerId,
      currentCommunityId: fx.communityAId,
    });
    expect(() => assertCurrentCommunity(viewer, fx.communityAId)).not.toThrow();
    await expectAppError(
      () => Promise.resolve(assertCurrentCommunity(viewer, fx.communityBId)),
      'FORBIDDEN',
      403,
    );
  });

  it('OWNER：发布者通过；非发布者 403；跨社区 404（不泄漏存在性）', async () => {
    const owner = await requireUser({ userId: fx.ownerId, currentCommunityId: fx.communityAId });
    await expect(requireOwner(owner, fx.itemAId)).resolves.toMatchObject({ id: fx.itemAId });

    const stranger = await requireUser({
      userId: fx.strangerId,
      currentCommunityId: fx.communityAId,
    });
    await expectAppError(() => requireOwner(stranger, fx.itemAId), 'FORBIDDEN', 403);

    // dual 当前在乙，访问甲内 itemA → 404
    const dualInB = await requireUser({ userId: fx.dualId, currentCommunityId: fx.communityBId });
    await expectAppError(() => requireOwner(dualInB, fx.itemAId), 'NOT_FOUND', 404);
  });

  it('ACCEPTED_APPLICANT：被接受申请人通过；仅 PENDING 的申请人 403；发布者 403', async () => {
    const dualInA = await requireUser({ userId: fx.dualId, currentCommunityId: fx.communityAId });
    await expect(requireAcceptedApplicant(dualInA, fx.itemAId)).resolves.toMatchObject({
      id: fx.acceptedClaimId,
      status: 'ACCEPTED',
    });

    const stranger = await requireUser({
      userId: fx.strangerId,
      currentCommunityId: fx.communityAId,
    });
    await expectAppError(() => requireAcceptedApplicant(stranger, fx.itemAId), 'FORBIDDEN', 403);

    const owner = await requireUser({ userId: fx.ownerId, currentCommunityId: fx.communityAId });
    await expectAppError(() => requireAcceptedApplicant(owner, fx.itemAId), 'FORBIDDEN', 403);
  });
});
