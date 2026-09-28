/**
 * `GET /api/me/notifications?unreadOnly=` —— 我的通知（§6）。
 *
 * `200 { data: NotificationDto[] }`，`createdAt` 倒序，上限 100；
 * 通知**不属于任何社区作用域**（个人数据，切空间不丢历史），故只做 `requireUser` + `requireMember`
 * （后者是 §0.3 对「需登录端点」的一致口径，与 `GET /api/me` 同源）。
 */
import { NotificationListQuerySchema } from '@/shared/schemas';
import type { NotificationDto } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, parseSearchParams, withRoute } from '@/server/http';
import { listMyNotifications } from '@/server/notifications/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const query = parseSearchParams(request, NotificationListQuerySchema);
  const data: NotificationDto[] = await listMyNotifications(viewer, query);
  return jsonOk(data);
});
