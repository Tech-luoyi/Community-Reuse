/**
 * 权限守卫：**由关系推导**的访问控制（无角色列、无 ADMIN）。
 *
 * 契约：docs/api-contract.md §0.3 与 §4。
 * 关系角色（不落库，纯推导）：
 *   - `GUEST`               ：无有效会话。
 *   - `MEMBER`              ：`CommunityMember(communityId=当前社区, userId)` 存在。
 *   - `OWNER`               ：`Item.ownerId === 当前用户`（且物品属于当前社区）。
 *   - `ACCEPTED_APPLICANT`  ：存在 `ClaimRequest{ itemId, applicantId=当前用户, status ∈ {ACCEPTED, COMPLETED} }`。
 *
 * 多租户硬红线：**社区只认服务端会话**（`session.currentCommunityId`）；任何来自入参 / 请求体 /
 * 查询串的 `communityId` 都不得直接用于作用域，必须先用 `assertCurrentCommunity` 与会话比对。
 *
 * 越权一律 403（FORBIDDEN）；未登录一律 401（UNAUTHENTICATED）；跨社区访问资源按 404 处理（不泄漏存在性）。
 */
import type { ClaimStatus, ItemStatus, Prisma, TradeType } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import type { SessionData } from './session';

/** 已认证的访问者（会话 + 用户资料 + 当前租户）。 */
export interface Viewer {
  id: string;
  nickname: string;
  contactText: string | null;
  currentCommunityId: string;
}

/**
 * 要求已登录：会话有效且用户存在。
 * @throws AppError UNAUTHENTICATED（无会话 / 用户不存在）
 */
export async function requireUser(session: SessionData | null): Promise<Viewer> {
  if (!session) {
    throw errors.unauthenticated();
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, nickname: true, contactText: true },
  });
  if (!user) {
    // 会话签名有效但用户已被删除 —— 仍视为未登录（不得凭空放行）。
    throw errors.unauthenticated('会话对应的用户不存在');
  }
  return {
    id: user.id,
    nickname: user.nickname,
    contactText: user.contactText,
    currentCommunityId: session.currentCommunityId,
  };
}

/**
 * 要求访问者是**当前社区**的成员。
 * @throws AppError FORBIDDEN（非成员）
 */
export async function requireMember(viewer: Viewer): Promise<void> {
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: { communityId: viewer.currentCommunityId, userId: viewer.id },
    },
    select: { id: true },
  });
  if (!membership) {
    throw errors.forbidden('你不是当前社区的成员');
  }
}

/**
 * 多租户红线：外部传入的 `communityId` 必须与会话社区一致，否则 403。
 * 用于请求体 / 查询串携带 `communityId` 的接口（如 `POST /api/items`）。
 * @throws AppError FORBIDDEN
 */
export function assertCurrentCommunity(viewer: Viewer, communityId: string): void {
  if (communityId !== viewer.currentCommunityId) {
    throw errors.forbidden('只能操作当前社区的数据');
  }
}

/** 经守卫加载的当前社区内的物品（含改价不变式所需的 tradeType / price；name / description 供通知文案与 prompt）。 */
export interface GuardedItem {
  id: string;
  ownerId: string;
  communityId: string;
  name: string;
  /**
   * 物品描述。**刻意包含在守卫的同一次读取里**：FAQ 的 prompt 需要它，若守卫只返回
   * 骨架字段，调用方就得为拿描述再查一次同一行——那既多一次往返，又让「授权校验读的行」
   * 与「实际使用的描述」不是同一份快照（TOCTOU）。描述是 2000 字符的 VarChar，
   * 随行一起取回的成本可以忽略。
   */
  description: string;
  status: ItemStatus;
  tradeType: TradeType;
  price: Prisma.Decimal | null;
}

/** 当前社区内的物品（不存在或跨社区均按 404，不泄漏跨租户存在性）。 */
export async function loadItemInCurrentCommunity(
  viewer: Viewer,
  itemId: string,
): Promise<GuardedItem> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      ownerId: true,
      communityId: true,
      name: true,
      description: true,
      status: true,
      tradeType: true,
      price: true,
    },
  });
  if (!item || item.communityId !== viewer.currentCommunityId) {
    throw errors.notFound('物品不存在');
  }
  return item;
}

/**
 * 要求访问者是该物品的**发布者**（且物品在会话社区内）。
 * @throws AppError NOT_FOUND（物品不存在 / 跨社区）| FORBIDDEN（非发布者）
 */
export async function requireOwner(viewer: Viewer, itemId: string): Promise<GuardedItem> {
  const item = await loadItemInCurrentCommunity(viewer, itemId);
  if (item.ownerId !== viewer.id) {
    throw errors.forbidden('只有发布者可以执行该操作');
  }
  return item;
}

/**
 * 要求访问者是该物品**被接受的领取申请人**（`ACCEPTED` / `COMPLETED`）。
 * @throws AppError NOT_FOUND（物品不存在 / 跨社区）| FORBIDDEN（非被接受申请人）
 */
export async function requireAcceptedApplicant(
  viewer: Viewer,
  itemId: string,
): Promise<{ id: string; status: string }> {
  await loadItemInCurrentCommunity(viewer, itemId);
  const claim = await prisma.claimRequest.findFirst({
    where: {
      itemId,
      applicantId: viewer.id,
      status: { in: ['ACCEPTED', 'COMPLETED'] },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!claim) {
    throw errors.forbidden('只有被接受的申请人可以执行该操作');
  }
  return claim;
}

/* ===========================================================================
 * 领取申请（ClaimRequest）守卫 —— 契约 api-contract.md §4
 * =========================================================================== */

/** 经守卫加载的当前社区内的领取申请（含构建 `ClaimDto` 所需的双方资料）。 */
export interface GuardedClaim {
  id: string;
  itemId: string;
  applicantId: string;
  message: string | null;
  preferredAt: Date | null;
  preferredLocation: string | null;
  status: ClaimStatus;
  createdAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  applicant: { id: string; nickname: string; contactText: string | null };
  item: {
    id: string;
    ownerId: string;
    communityId: string;
    name: string;
    status: ItemStatus;
    owner: { id: string; contactText: string | null };
  };
}

/**
 * 加载当前社区内的领取申请（申请不存在，或其物品不在会话社区 → 404，不泄漏跨租户存在性）。
 * @throws AppError NOT_FOUND
 */
export async function loadClaimInCurrentCommunity(
  viewer: Viewer,
  claimId: string,
): Promise<GuardedClaim> {
  const claim = await prisma.claimRequest.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      itemId: true,
      applicantId: true,
      message: true,
      preferredAt: true,
      preferredLocation: true,
      status: true,
      createdAt: true,
      acceptedAt: true,
      completedAt: true,
      applicant: { select: { id: true, nickname: true, contactText: true } },
      item: {
        select: {
          id: true,
          ownerId: true,
          communityId: true,
          name: true,
          status: true,
          owner: { select: { id: true, contactText: true } },
        },
      },
    },
  });
  if (!claim || claim.item.communityId !== viewer.currentCommunityId) {
    throw errors.notFound('领取申请不存在');
  }
  return claim;
}

/**
 * 要求访问者是该申请**所属物品的发布者**。
 * @throws AppError FORBIDDEN
 */
export function requireItemOwnerViaClaim(viewer: Viewer, claim: GuardedClaim): void {
  if (viewer.id !== claim.item.ownerId) {
    throw errors.forbidden('只有物品发布者可以执行该操作');
  }
}

/**
 * 要求访问者是该申请的**申请人本人**。
 * @throws AppError FORBIDDEN
 */
export function requireApplicantViaClaim(viewer: Viewer, claim: GuardedClaim): void {
  if (viewer.id !== claim.applicantId) {
    throw errors.forbidden('只有申请人可以执行该操作');
  }
}
