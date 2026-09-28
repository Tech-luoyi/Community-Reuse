/**
 * `GET /api/stats/community` —— 数据看板（§7）。
 *
 * `200 { data: StatsDto }`；`communityId?` 缺省取会话社区，**显式传入必须一致**（否则 403，
 * 判定在 `assertCurrentCommunity`）。空态由 `StatsDto.fastestItem / mostWantedItem = null` 表达，
 * 前端渲染「暂无」而非 0。
 */
import { StatsQuerySchema } from '@/shared/schemas';
import type { StatsDto } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, parseSearchParams, withRoute } from '@/server/http';
import { getCommunityStats } from '@/server/stats/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const query = parseSearchParams(request, StatsQuerySchema);
  const data: StatsDto = await getCommunityStats(viewer, query);
  return jsonOk(data);
});
