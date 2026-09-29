/**
 * `GET | POST /api/items/:id/messages` —— 公开留言板（§5）。
 *
 *   - GET  ：MEMBER → `200 { data: MessageDto[] }`（升序全量）；跨社区物品 → `NOT_FOUND`。
 *   - POST ：MEMBER 发普通留言；`senderType:"AI"` **仅发布者**（否则 403，判定在服务层）。
 *            → `201 { data: MessageDto }`；`content` 空/超长 → `INVALID_INPUT`。
 */
import { MessageRequestSchema } from '@/shared/schemas';
import type { MessageDto } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonCreated, jsonOk, parseJsonBody, withRoute } from '@/server/http';
import { listItemMessages, postItemMessage } from '@/server/messages/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ItemRouteContext = { params: Promise<{ id: string }> };

async function resolveItemId(context: ItemRouteContext): Promise<string> {
  return (await context.params).id;
}

export const GET = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const messages: MessageDto[] = await listItemMessages(viewer, await resolveItemId(context));
    return jsonOk(messages);
  },
);

export const POST = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const itemId = await resolveItemId(context);
    const body = await parseJsonBody(request, MessageRequestSchema);
    const message = await postItemMessage(viewer, itemId, body);
    return jsonCreated(message);
  },
);
