/**
 * `POST /api/me/notifications/:id/read` —— 标记已读（§6）。
 *
 * `200 { data: NotificationDto }`；**幂等**（重复调用返回同一 DTO，`readAt` 保持首次值）。
 * 不存在或属于他人 → `NOT_FOUND`(404)：不按"是否别人的"分流错误码，避免泄漏他人资源存在性。
 */
import type { NotificationDto } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, withRoute } from '@/server/http';
import { markNotificationRead } from '@/server/notifications/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NotificationRouteContext = { params: Promise<{ id: string }> | { id: string } };

export const POST = withRoute(
  async (request: Request, context: NotificationRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const { id } = await context.params;
    const data: NotificationDto = await markNotificationRead(viewer, id);
    return jsonOk(data);
  },
);
