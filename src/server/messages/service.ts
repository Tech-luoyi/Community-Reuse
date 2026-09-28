/**
 * 留言板读写（`src/server/messages/service.ts`）。
 *
 * 事实源：docs/api-contract.md §5。
 *   - **读**走 raw SQL（`MESSAGE_LIST_SQL`），**写**走 Prisma Client（P5）。
 *   - 作用域：先 `loadItemInCurrentCommunity` ⇒ 物品不存在或跨社区 → `NOT_FOUND`（不泄漏存在性）。
 *   - **AI 行的归属**：`senderType='AI'` 仅物品**发布者**可发（`requireOwner`），
 *     且服务端**强制** `authorId=null`——即使客户端在别处塞了身份也不采信（§5 细则）。
 *   - 写回显与列表**共用同一 mapper**：`create` 的 select 结果 + 观看者资料拼成同一行形状，
 *     保证 `POST` 返回的 DTO 与随后 `GET` 里的同一条**逐字段一致**。
 */
import type { MessageDto, MessageRequest, MessageSenderType, UserSummary } from '@/shared/types';

import { type Viewer, loadItemInCurrentCommunity, requireOwner } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { MESSAGE_LIST_SQL } from './sql';

/** 留言行（raw 查询结果 / 写后拼装结果共用）。`author_*` 对 AI 行恒为 `null`。 */
export interface RawMessageRow {
  id: string;
  itemId: string;
  senderType: MessageSenderType;
  content: string;
  createdAt: Date;
  author_id: string | null;
  author_nickname: string | null;
}

/** 留言行 → `MessageDto`（AI 行 `author` 为 `null`）。 */
export function mapMessageRow(row: RawMessageRow): MessageDto {
  const author: UserSummary | null =
    row.author_id === null || row.author_nickname === null
      ? null
      : { id: row.author_id, nickname: row.author_nickname };
  return {
    id: row.id,
    itemId: row.itemId,
    senderType: row.senderType,
    author,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 某物品的公开留言（升序全量，§5）。 */
export async function listItemMessages(viewer: Viewer, itemId: string): Promise<MessageDto[]> {
  await loadItemInCurrentCommunity(viewer, itemId);
  const rows = await prisma.$queryRawUnsafe<RawMessageRow[]>(MESSAGE_LIST_SQL, itemId);
  return rows.map(mapMessageRow);
}

/**
 * 发一条留言（`USER`）或以发布者身份代投 AI 建议（`AI`）。
 * @throws AppError NOT_FOUND（物品不在当前社区）| FORBIDDEN（非发布者发 AI 建议）
 */
export async function postItemMessage(
  viewer: Viewer,
  itemId: string,
  input: MessageRequest,
): Promise<MessageDto> {
  const isAi = input.senderType === 'AI';
  if (isAi) {
    await requireOwner(viewer, itemId);
  } else {
    await loadItemInCurrentCommunity(viewer, itemId);
  }

  const created = await prisma.message.create({
    data: {
      itemId,
      // AI 行**必须**无作者外键（schema 允许 `authorId?`），前端标签据此渲染。
      authorId: isAi ? null : viewer.id,
      senderType: isAi ? 'AI' : 'USER',
      content: input.content,
    },
    select: { id: true, itemId: true, senderType: true, content: true, createdAt: true },
  });

  return mapMessageRow({
    id: created.id,
    itemId: created.itemId,
    senderType: created.senderType,
    content: created.content,
    createdAt: created.createdAt,
    author_id: isAi ? null : viewer.id,
    author_nickname: isAi ? null : viewer.nickname,
  });
}
