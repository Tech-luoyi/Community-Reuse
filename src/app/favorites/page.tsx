'use client';

import { PENDING_ENDPOINTS } from '@/lib/pending';
import { EmptyState, PendingApi, SectionTitle } from '@/components/ui';

export default function FavoritesPage() {
  /*
    `GET /api/me/favorites`（契约 §6）尚未实现，因此这里**不发请求**：
    发一次就是一次 404，而把它 `.catch(() => [])` 之后渲染「收藏夹还空着」，
    等于对着一堆已经点过的心形说它们从没存在过。
    接口就位后，把本段换回 useQuery + ItemCard 网格即可。
  */
  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="收藏夹"
        title={
          <>
            我的<span className="text-rose-500">心动好物</span>
          </>
        }
        desc="点过 ❤️ 的都在这里；被别人抢先也没关系，继续找下一个。"
      />
      <PendingApi
        endpoint={PENDING_ENDPOINTS.myFavorites}
        section="§6"
        note="收藏的写入与读取都还没实现，所以物品详情页上的爱心当前是不可点的（而不是点了会亮、刷新就没了）。"
      />
      <EmptyState
        emoji="💌"
        title="先逛逛，看到心动的记在心里"
        hint="收藏夹会在 §6 接口就位后立刻可用，届时你点过的心都会回来。"
      />
    </div>
  );
}
