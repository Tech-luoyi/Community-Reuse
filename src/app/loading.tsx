import { Skeleton } from '@/components/ui';

/**
 * 路由级 pending 态（App Router 的 `loading.tsx` = Suspense 边界）。
 *
 * 放在根 `src/app/loading.tsx`：根 `layout.tsx` 把 `{children}` 交给
 * `AppShell` 的 `<main class="max-w-6xl">`，所以这个骨架正好落在内容区，
 * 顶栏与底部导航保持可见。骨架形状取「标题块 + 卡片网格」，与发现流 /
 * 收藏 / 看板三类页面同构，避免切页时的版式跳动。
 *
 * **作用边界（实测校正，别高估它）**：它覆盖的是「路由状态已提交、页面仍在
 * 挂载/取数」这段，也就是硬导航（首次直连、刷新、外链进入）以及客户端组件
 * 自身 suspend 的情形。
 *
 * 它**不能**提前于 dev 下的 RSC 往返：`navigateReducer` 返回 `data.then(...)`，
 * React 在载荷到达前不提交新状态，所以骨架与 URL 变化同刻出现（实测根骨架
 * 1823ms、`/favorites` 骨架 1618ms，而两次载荷分别在 1814ms / 1532ms 就已
 * 到达）—— 点击后那段等待它盖不住。原因再往上一层是 Next 在 dev 下硬关了
 * 预取：`link.js` 跳过视口预取、`app-router.js` 的 `createPrefetchURL` 对
 * `router.prefetch()` 直接 return null（注释原文「Don't prefetch during
 * development」）。生产下视口预取生效，导航 35~69ms，这个边界基本不会触发。
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" role="status">
      <span className="sr-only">页面加载中…</span>

      <div className="space-y-2.5">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-3xl" />
        ))}
      </div>
    </div>
  );
}
