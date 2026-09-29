'use client';

import Link from 'next/link';
import { BellRing, CheckCheck, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { Button, EmptyState, SectionTitle, Skeleton } from '@/components/ui';

interface NotificationDto {
  id: string;
  type: string;
  title: string;
  content: string;
  readAt: string | null;
  createdAt: string;
}

const TYPE_ICON: Record<string, { e: string; bg: string }> = {
  CLAIM_RECEIVED: { e: '🙋', bg: 'from-amber-400 to-orange-500' },
  CLAIM_ACCEPTED: { e: '🎉', bg: 'from-emerald-400 to-teal-500' },
  CLAIM_REJECTED: { e: '🙅', bg: 'from-stone-400 to-stone-500' },
  CLAIM_COMPLETED: { e: '🤝', bg: 'from-sky-400 to-blue-500' },
  ITEM_RESERVED: { e: '📌', bg: 'from-violet-400 to-purple-500' },
  ITEM_ARCHIVED: { e: '📦', bg: 'from-rose-400 to-pink-500' },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get<NotificationDto[]>('/api/me/notifications'),
    // §6 的读取接口尚未实现：接好线但不发请求，避免每次进页面吃一个 404。
    // 下面 `data === null` 分支已经是诚实的「联调中」态，因此这里无需再兜底假数据。
    enabled: false,
  });

  async function markRead(id: string) {
    try {
      await post(`/api/me/notifications/${id}/read`);
      await qc.invalidateQueries({ queryKey: ['notifications'] });
      await qc.invalidateQueries({ queryKey: ['notifications-badge'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '标记失败');
    }
  }

  async function markAll() {
    if (!data) return;
    const unread = data.filter((n) => !n.readAt);
    if (!unread.length) return toast.info('没有未读通知');
    await Promise.all(unread.map((n) => markRead(n.id)));
    toast.success(`已读 ${unread.length} 条 ✅`);
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (data === null || data === undefined) {
    return (
      <div className="mx-auto max-w-2xl">
        <SectionTitle
          kicker="通知"
          title="站内通知"
          desc="站内通知后端接口待联调（api-contract.md §6），前端已按契约实现。"
        />
        <div className="mt-4">
          <EmptyState
            emoji="📭"
            title="通知接口联调中"
            hint="GET /api/me/notifications · POST /api/me/notifications/:id/read"
          />
        </div>
      </div>
    );
  }

  const unreadCount = data.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <SectionTitle
          kicker="通知中心"
          title={
            <>
              消息<span className="text-amber-500">不错过</span>
            </>
          }
          desc={unreadCount ? `${unreadCount} 条未读` : '全部已读 🎉'}
        />
        <Button variant="outline" size="sm" onClick={markAll}>
          <CheckCheck size={15} /> 全部已读
        </Button>
      </div>

      <div className="space-y-2">
        {data.length === 0 && (
          <EmptyState emoji="🔕" title="还没有通知" hint="有人对你的物品点“想要”时会出现在这里。" />
        )}
        {data.map((n) => {
          const icon = TYPE_ICON[n.type] ?? { e: '🔔', bg: 'from-stone-400 to-stone-500' };
          return (
            <button
              key={n.id}
              onClick={() => markRead(n.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-3xl border p-4 text-left transition',
                n.readAt
                  ? 'border-stone-200/70 bg-white/60'
                  : 'border-amber-300/70 bg-gradient-to-r from-amber-50 to-white shadow-[0_4px_18px_rgba(245,158,11,.14)]',
              )}
            >
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${icon.bg} text-xl shadow-md`}
              >
                {icon.e}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-black">{n.title}</span>
                  {!n.readAt && (
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
                  )}
                  <span className="ml-auto shrink-0 text-[11px] font-bold text-stone-400">
                    {formatDateTime(n.createdAt)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-500">{n.content}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 pt-2 text-xs font-bold text-stone-400">
        <BellRing size={13} /> 悬停 → 点击标记已读
        <Link href="/requests" className="text-emerald-600 hover:underline">
          · 去处理领取申请 →
        </Link>
        {!data.length && <Loader2 size={13} className="hidden" />}
      </div>
    </div>
  );
}
