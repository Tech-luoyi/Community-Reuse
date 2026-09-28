/**
 * 领取申请状态机（契约 docs/api-contract.md §4；转移细则以 docs/tech-design-final.md §4.1 为准）。
 *
 * 设计要点：
 *   - **写路径全部走 Prisma Client**（P5）：raw 写入会让 `@default(now())` 随会话时区漂移、
 *     并让 `@updatedAt` 不推进。仅在 `accept`/`reject`/`cancel`/`complete` 的**事务内**用
 *     `SELECT … FOR UPDATE` 做**行锁（读）**——读 raw 是允许的。
 *   - **并发安全**：`accept` 先在事务内锁物品行，再校验「目标申请 PENDING + 物品 ACTIVE」，
 *     失败即抛 409 回滚 ⇒ 两个并发 `accept` 恰有一个成功。
 *   - **`contactText` 可见性**：委托 `claimContactTextForViewer`（D1 单点），不在此另写一份。
 *   - **通知**：`CLAIM_RECEIVED`/`CLAIM_ACCEPTED`/`CLAIM_REJECTED`/`CLAIM_COMPLETED`；
 *     `ITEM_RESERVED`/`ITEM_ARCHIVED` 枚举值**预留**（本轮不使用）。
 */
import type { Prisma } from '@prisma/client';

import type { ClaimDto, ClaimListQuery, CreateClaimRequest } from '@/shared/types';

import { claimContactTextForViewer } from '@/server/auth/contact';
import {
  type GuardedClaim,
  type Viewer,
  loadClaimInCurrentCommunity,
  loadItemInCurrentCommunity,
  requireApplicantViaClaim,
  requireItemOwnerViaClaim,
} from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

/** 构建 `ClaimDto` 所需的申请行（含双方资料）；与 `GuardedClaim` 结构一致。 */
const CLAIM_SELECT = {
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
} as const;

/** 空白 / undefined → null（写库归一化）。 */
function emptyToNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/** 申请行 → `ClaimDto`（`contactText` 按观看者关系裁剪，D1）。 */
function toClaimDto(claim: GuardedClaim, viewerId: string): ClaimDto {
  return {
    id: claim.id,
    itemId: claim.itemId,
    applicant: { id: claim.applicant.id, nickname: claim.applicant.nickname },
    message: claim.message,
    preferredAt: toIsoOrNull(claim.preferredAt),
    preferredLocation: claim.preferredLocation,
    status: claim.status,
    contactText: claimContactTextForViewer({
      status: claim.status,
      viewerId,
      ownerId: claim.item.ownerId,
      applicantId: claim.applicantId,
      ownerContactText: claim.item.owner.contactText,
      applicantContactText: claim.applicant.contactText,
    }),
    createdAt: toIso(claim.createdAt),
    acceptedAt: toIsoOrNull(claim.acceptedAt),
    completedAt: toIsoOrNull(claim.completedAt),
  };
}

/** 事务内锁定物品行（读），返回其当前状态；供各转移在同一把锁下串行化。 */
async function lockItemStatus(
  tx: Prisma.TransactionClient,
  itemId: string,
): Promise<string | undefined> {
  const rows = await tx.$queryRawUnsafe<{ id: string; status: string }[]>(
    `SELECT id, status FROM "Item" WHERE id = $1 FOR UPDATE`,
    itemId,
  );
  return rows[0]?.status;
}

/**
 * 提交领取申请（§4）。
 * - 物品不在会话社区 → 404；发布者申请自己的物品 → 403；
 *   物品非 `ACTIVE`、或已有同申请人 `PENDING` → 409。
 * - 事务内：建 `PENDING` 申请 + 给物品 owner 写一条 `CLAIM_RECEIVED`。
 */
export async function submitClaim(
  viewer: Viewer,
  itemId: string,
  input: CreateClaimRequest,
): Promise<ClaimDto> {
  const item = await loadItemInCurrentCommunity(viewer, itemId);
  if (item.ownerId === viewer.id) {
    throw errors.forbidden('不能申请自己发布的物品');
  }
  if (item.status !== 'ACTIVE') {
    throw errors.claimConflict('物品当前不可申请');
  }
  const existing = await prisma.claimRequest.findFirst({
    where: { itemId, applicantId: viewer.id, status: 'PENDING' },
    select: { id: true },
  });
  if (existing) {
    throw errors.claimConflict('你已提交过待处理的申请');
  }

  const createdId = await prisma.$transaction(async (tx) => {
    const claim = await tx.claimRequest.create({
      data: {
        itemId,
        applicantId: viewer.id,
        message: emptyToNull(input.message),
        preferredAt: input.preferredAt === undefined ? null : new Date(input.preferredAt),
        preferredLocation: emptyToNull(input.preferredLocation),
        status: 'PENDING',
      },
      select: { id: true },
    });
    await tx.notification.create({
      data: {
        userId: item.ownerId,
        type: 'CLAIM_RECEIVED',
        title: '收到新的领取申请',
        content: `「${item.name}」收到一条新的领取申请，请及时处理。`,
      },
    });
    return claim.id;
  });

  const row = await loadClaimInCurrentCommunity(viewer, createdId);
  return toClaimDto(row, viewer.id);
}

/**
 * 查看某物品的申请（§4）：OWNER → 该物品全部；非 owner 的申请人 → 仅自己那条；其余人 → 403。
 * 按 `createdAt DESC`。
 */
export async function listItemClaims(viewer: Viewer, itemId: string): Promise<ClaimDto[]> {
  const item = await loadItemInCurrentCommunity(viewer, itemId);
  const isOwner = item.ownerId === viewer.id;
  const rows = await prisma.claimRequest.findMany({
    where: isOwner ? { itemId } : { itemId, applicantId: viewer.id },
    orderBy: { createdAt: 'desc' },
    select: CLAIM_SELECT,
  });
  if (!isOwner && rows.length === 0) {
    throw errors.forbidden('只有发布者或申请人可以查看该物品的申请');
  }
  return rows.map((row) => toClaimDto(row, viewer.id));
}

/**
 * 我在当前社区的申请（§4）：`applied` = 我发起的；`received` = 我名下物品收到的。
 * 作用域仅当前会话社区；按 `createdAt DESC`。
 */
export async function listMyClaims(viewer: Viewer, as: ClaimListQuery['as']): Promise<ClaimDto[]> {
  const where: Prisma.ClaimRequestWhereInput =
    as === 'received'
      ? { item: { ownerId: viewer.id, communityId: viewer.currentCommunityId } }
      : { applicantId: viewer.id, item: { communityId: viewer.currentCommunityId } };
  const rows = await prisma.claimRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: CLAIM_SELECT,
  });
  return rows.map((row) => toClaimDto(row, viewer.id));
}

/**
 * 接受申请（OWNER，§4 / §4.1）——**单事务四步 + 行锁**：
 * 1. 锁物品行；2. 目标申请 `PENDING` 且物品 `ACTIVE`（否则 409）；
 * 3. 申请 → `ACCEPTED`+`acceptedAt`、物品 → `RESERVED`+`reservedAt`；
 * 4. 同物品其他 `PENDING` → `REJECTED`；写 `CLAIM_ACCEPTED`（申请人）与 `CLAIM_REJECTED`（被挤出者）。
 */
export async function acceptClaim(viewer: Viewer, claimId: string): Promise<ClaimDto> {
  const claim = await loadClaimInCurrentCommunity(viewer, claimId);
  requireItemOwnerViaClaim(viewer, claim);

  await prisma.$transaction(async (tx) => {
    const itemStatus = await lockItemStatus(tx, claim.itemId);
    const current = await tx.claimRequest.findUnique({
      where: { id: claimId },
      select: { status: true },
    });
    if (current?.status !== 'PENDING' || itemStatus !== 'ACTIVE') {
      throw errors.claimConflict('物品或申请状态已变化，无法接受该申请');
    }

    await tx.claimRequest.update({
      where: { id: claimId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    await tx.item.update({
      where: { id: claim.itemId },
      data: { status: 'RESERVED', reservedAt: new Date() },
    });

    const displaced = await tx.claimRequest.findMany({
      where: { itemId: claim.itemId, status: 'PENDING', id: { not: claimId } },
      select: { id: true, applicantId: true },
    });
    if (displaced.length > 0) {
      await tx.claimRequest.updateMany({
        where: { id: { in: displaced.map((c) => c.id) } },
        data: { status: 'REJECTED' },
      });
    }

    await tx.notification.create({
      data: {
        userId: claim.applicantId,
        type: 'CLAIM_ACCEPTED',
        title: '申请已通过',
        content: `你对「${claim.item.name}」的领取申请已被接受，请与对方约定交接。`,
      },
    });
    for (const other of displaced) {
      await tx.notification.create({
        data: {
          userId: other.applicantId,
          type: 'CLAIM_REJECTED',
          title: '申请未通过',
          content: `很遗憾，你对「${claim.item.name}」的领取申请未被接受。`,
        },
      });
    }
  });

  const row = await loadClaimInCurrentCommunity(viewer, claimId);
  return toClaimDto(row, viewer.id);
}

/**
 * 拒绝申请（OWNER，§4.1）：
 * - `PENDING → REJECTED`（物品不变）；
 * - `ACCEPTED → REJECTED` 且**释放物品**（`RESERVED → ACTIVE`、`reservedAt = null`）；
 * - 其余状态 → 409。通知申请人 `CLAIM_REJECTED`。
 */
export async function rejectClaim(viewer: Viewer, claimId: string): Promise<ClaimDto> {
  const claim = await loadClaimInCurrentCommunity(viewer, claimId);
  requireItemOwnerViaClaim(viewer, claim);

  await prisma.$transaction(async (tx) => {
    await lockItemStatus(tx, claim.itemId);
    const current = await tx.claimRequest.findUnique({
      where: { id: claimId },
      select: { status: true },
    });
    const status = current?.status;

    if (status === 'PENDING') {
      await tx.claimRequest.update({ where: { id: claimId }, data: { status: 'REJECTED' } });
    } else if (status === 'ACCEPTED') {
      await tx.claimRequest.update({ where: { id: claimId }, data: { status: 'REJECTED' } });
      await tx.item.update({
        where: { id: claim.itemId },
        data: { status: 'ACTIVE', reservedAt: null },
      });
    } else {
      throw errors.claimConflict('仅待处理或已接受的申请可被拒绝');
    }

    await tx.notification.create({
      data: {
        userId: claim.applicantId,
        type: 'CLAIM_REJECTED',
        title: '申请未通过',
        content: `很遗憾，你对「${claim.item.name}」的领取申请未被接受。`,
      },
    });
  });

  const row = await loadClaimInCurrentCommunity(viewer, claimId);
  return toClaimDto(row, viewer.id);
}

/**
 * 取消申请（申请人本人，§4.1）：
 * - `PENDING → CANCELED`（物品不变）；
 * - `ACCEPTED → CANCELED` 且**释放物品**（`RESERVED → ACTIVE`、`reservedAt = null`）；
 * - 其余状态 → 409。**不发通知**（`NotificationType` 无 cancel 语义）。
 */
export async function cancelClaim(viewer: Viewer, claimId: string): Promise<ClaimDto> {
  const claim = await loadClaimInCurrentCommunity(viewer, claimId);
  requireApplicantViaClaim(viewer, claim);

  await prisma.$transaction(async (tx) => {
    await lockItemStatus(tx, claim.itemId);
    const current = await tx.claimRequest.findUnique({
      where: { id: claimId },
      select: { status: true },
    });
    const status = current?.status;

    if (status === 'PENDING') {
      await tx.claimRequest.update({ where: { id: claimId }, data: { status: 'CANCELED' } });
    } else if (status === 'ACCEPTED') {
      await tx.claimRequest.update({ where: { id: claimId }, data: { status: 'CANCELED' } });
      await tx.item.update({
        where: { id: claim.itemId },
        data: { status: 'ACTIVE', reservedAt: null },
      });
    } else {
      throw errors.claimConflict('仅待处理或已接受的申请可被取消');
    }
  });

  const row = await loadClaimInCurrentCommunity(viewer, claimId);
  return toClaimDto(row, viewer.id);
}

/**
 * 完成交接（OWNER，§4.1）：`ACCEPTED → COMPLETED`+`completedAt`；
 * 物品 `RESERVED → ARCHIVED`+`archivedAt`（**应用时钟**）；其余状态 → 409。
 * 通知申请人 `CLAIM_COMPLETED`。
 */
export async function completeClaim(viewer: Viewer, claimId: string): Promise<ClaimDto> {
  const claim = await loadClaimInCurrentCommunity(viewer, claimId);
  requireItemOwnerViaClaim(viewer, claim);

  await prisma.$transaction(async (tx) => {
    await lockItemStatus(tx, claim.itemId);
    const current = await tx.claimRequest.findUnique({
      where: { id: claimId },
      select: { status: true },
    });
    if (current?.status !== 'ACCEPTED') {
      throw errors.claimConflict('仅已接受的申请可标记为已完成');
    }

    await tx.claimRequest.update({
      where: { id: claimId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await tx.item.update({
      where: { id: claim.itemId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await tx.notification.create({
      data: {
        userId: claim.applicantId,
        type: 'CLAIM_COMPLETED',
        title: '交接已完成',
        content: `「${claim.item.name}」的交接已完成，感谢你的参与。`,
      },
    });
  });

  const row = await loadClaimInCurrentCommunity(viewer, claimId);
  return toClaimDto(row, viewer.id);
}
