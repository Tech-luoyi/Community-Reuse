/**
 * 通知读与标记已读（`src/server/notifications/service.ts`）。
 *
 * 事实源：docs/api-contract.md §6。
 *   - **写通知**的入口全在领取状态机里（`claims/service.ts` 的事务内 `notification.create`），
 *     本模块只负责**读**与**已读**（P5：读走 raw SQL 常量；单行回显与写走 Prisma Client）。
 *   - 已读**只能作用于自己的通知**：不存在或属于他人 → `NOT_FOUND`(404)，不泄漏他人资源存在性。
 *   - 已读**幂等**：重复标记返回同一 DTO，`readAt` 保持首次值（不刷新时间戳）。
 */
import type { NotificationDto, NotificationListQuery, NotificationType } from '@/shared/types';

import { type Viewer } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { NOTIFICATION_LIST_SQL } from './sql';

/** 通知行（raw 查询结果）。 */
export interface RawNotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

/** 通知行 → `NotificationDto`（raw 与 Prisma 两种来源共用）。 */
export function mapNotificationRow(row: RawNotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 我的通知（`createdAt` 倒序，上限 100；`unreadOnly=true` 只看未读）。 */
export async function listMyNotifications(
  viewer: Viewer,
  query: NotificationListQuery,
): Promise<NotificationDto[]> {
  const rows = await prisma.$queryRawUnsafe<RawNotificationRow[]>(
    NOTIFICATION_LIST_SQL,
    viewer.id,
    query.unreadOnly === true ? true : null,
  );
  return rows.map(mapNotificationRow);
}

const NOTIFICATION_ROW_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * 标记一条通知为已读（幂等）。
 * @throws AppError NOT_FOUND（通知不存在 / 不属于当前用户）
 */
export async function markNotificationRead(
  viewer: Viewer,
  notificationId: string,
): Promise<NotificationDto> {
  const select = { ...NOTIFICATION_ROW_SELECT, userId: true } as const;
  const existing = await prisma.notification.findUnique({
    where: { id: notificationId },
    select,
  });
  // 别人的通知与不存在的通知同口径：404，不泄漏存在性。
  if (!existing || existing.userId !== viewer.id) {
    throw errors.notFound('通知不存在');
  }
  if (existing.readAt !== null) {
    return mapNotificationRow(existing);
  }
  // `readAt` 无 `@updatedAt` 之类语义，写入用应用时钟（契约 §6 只要求"已读时间"）。
  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: new Date() },
    select: NOTIFICATION_ROW_SELECT,
  });
  return mapNotificationRow(updated);
}
