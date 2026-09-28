/**
 * 数据看板聚合（`src/server/stats/service.ts`）。
 *
 * 事实源：docs/api-contract.md §7。5 条独立查询**并行**发出（`Promise.all`）：
 * 它们互不依赖，串行只会让看板首屏慢 5 倍；单条失败即整体 500，不做半截数据兜底
 * （半截真数与伪造 0 一样危险，见 §7「空态不得显示 0」）。
 */
import { STATS_TIMEZONE } from '@/shared/schemas';
import type { StatsDto, StatsQuery } from '@/shared/types';

import { type Viewer, assertCurrentCommunity } from '@/server/auth/guard';
import { prisma } from '@/server/db';

import { shanghaiMonthWindow } from './month';
import {
  STATS_ACTIVE_COUNT_SQL,
  STATS_FASTEST_ITEM_SQL,
  STATS_MOST_WANTED_ITEM_SQL,
  STATS_MONTH_COMPLETED_SQL,
  STATS_MONTH_PUBLISHED_SQL,
} from './sql';

interface CountRow {
  count: number;
}

interface FastestRow {
  id: string;
  name: string;
  duration_minutes: number;
}

interface WantedRow {
  id: string;
  name: string;
  want_count: number;
}

/** `COUNT(*)::int` 单值行 → `number`（缺行按 0）。 */
function countOf(rows: CountRow[]): number {
  return rows[0]?.count ?? 0;
}

/**
 * 当前社区看板。
 * `query.communityId` 显式传入时必须与会话社区一致（多租户红线，否则 403）。
 */
export async function getCommunityStats(viewer: Viewer, query: StatsQuery): Promise<StatsDto> {
  if (query.communityId !== undefined) {
    assertCurrentCommunity(viewer, query.communityId);
  }
  const communityId = viewer.currentCommunityId;
  const window = shanghaiMonthWindow(new Date());

  const [published, completed, active, fastestRows, wantedRows] = await Promise.all([
    prisma.$queryRawUnsafe<CountRow[]>(
      STATS_MONTH_PUBLISHED_SQL,
      communityId,
      window.start,
      window.end,
    ),
    prisma.$queryRawUnsafe<CountRow[]>(
      STATS_MONTH_COMPLETED_SQL,
      communityId,
      window.start,
      window.end,
    ),
    prisma.$queryRawUnsafe<CountRow[]>(STATS_ACTIVE_COUNT_SQL, communityId),
    prisma.$queryRawUnsafe<FastestRow[]>(STATS_FASTEST_ITEM_SQL, communityId),
    prisma.$queryRawUnsafe<WantedRow[]>(STATS_MOST_WANTED_ITEM_SQL, communityId),
  ]);

  const fastest = fastestRows[0];
  const wanted = wantedRows[0];

  return {
    monthPublished: countOf(published),
    monthCompleted: countOf(completed),
    activeCount: countOf(active),
    fastestItem:
      fastest === undefined
        ? null
        : { id: fastest.id, name: fastest.name, durationMinutes: fastest.duration_minutes },
    mostWantedItem:
      wanted === undefined
        ? null
        : { id: wanted.id, name: wanted.name, wantCount: wanted.want_count },
    timezone: STATS_TIMEZONE,
    monthRange: { start: window.startIso, end: window.endIso },
  };
}
