'use client';

import Link from 'next/link';
import {
  Archive,
  BellRing,
  CheckCheck,
  Check,
  Handshake,
  PackageCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import type { BadgeTone } from '@/components/ui';
import { Button, EmptyState, ErrorPanel, SectionTitle, Skeleton } from '@/components/ui';
import type { NotificationDto } from '@/shared/schemas';

/**
 * 通知类型 → 图标 + 色调。
 *
 * 上一版这里是 `{ e: '🙋', bg: 'from-amber-400 to-orange-500' }` ——
 * 六种通知配六个 emoji 和六套渐变，扫一眼列表就像一排彩色糖果。
 * 现在统一用 lucide 图标，色彩只取自状态色板。
 */
const TYPE_META: Record<string, { Icon: typeof BellRing; tone: BadgeTone }> = {
  CLAIM_RECEIVED: { Icon: UserPlus, tone: 'pending' },
  CLAIM_ACCEPTED: { Icon: Check, tone: 'available' },
  CLAIM_REJECTED: { Icon: X, tone: 'danger' },
  CLAIM_COMPLETED: { Icon: Handshake, tone: 'done' },
  ITEM_RESERVED: { Icon: PackageCheck, tone: 'reserved' },
  ITEM_ARCHIVED: { Icon: Archive, tone: 'archived' },
};

const TONE_ICON_CLASS: Record<BadgeTone, string> = {
  available: 'text-available',
  reserved: 'text-reserved',
  info: 'text-info',
  pending: 'text-pending',
  danger: 'text-danger',
  done: 'text-ink-secondary',
  archived: 'text-archived',
  ai: 'text-ai',
  neutral: 'text-ink-secondary',
};

const TONE_SURFACE_CLASS: Record<BadgeTone, string> = {
  available: 'bg-available-bg',
  reserved: 'bg-reserved-bg',
  info: 'bg-info-bg',
  pending: 'bg-pending-bg',
  danger: 'bg-danger-bg',
  done: 'bg-surface-sunken',
  archived: 'bg-surface-sunken',
  ai: 'bg-ai-bg',
  neutral: 'bg-surface-sunken',
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get<NotificationDto[]>('/api/me/notifications'),
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
    await Promise.all(unread.map((n) => post(`/api/me/notifications/${n.id}/read`)));
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    await qc.invalidateQueries({ queryKey: ['notifications-badge'] });
    toast.success(`已读 ${unread.length} 条`);
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SectionTitle kicker="通知" title="站内通知" />
        <ErrorPanel
          title="通知读取失败"
          hint="接口已就位，读不到就是出错了。"
          onRetry={() => void refetch()}
          fetching={isFetching}
        />
      </div>
    );
  }

  const unreadCount = data.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <SectionTitle
          kicker="通知中心"
          title="消息"
          desc={unreadCount ? `${unreadCount} 条未读` : '全部已读'}
        />
        <Button variant="secondary" size="sm" onClick={markAll} disabled={unreadCount === 0}>
          <CheckCheck size={14} /> 全部已读
        </Button>
      </div>

      <div className="space-y-1.5">
        {data.length === 0 && (
          <EmptyState
            icon={<BellRing size={18} />}
            title="还没有通知"
            hint="有人对你的物品点「想要」时会出现在这里。"
          />
        )}
        {data.map((n) => {
          const meta = TYPE_META[n.type] ?? { Icon: BellRing, tone: 'neutral' as BadgeTone };
          const { Icon } = meta;
          return (
            <button
              key={n.id}
              onClick={() => markRead(n.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                n.readAt
                  ? 'border-line bg-surface hover:bg-surface-sunken'
                  : 'border-line bg-surface hover:bg-surface-sunken',
              )}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-md',
                  TONE_SURFACE_CLASS[meta.tone],
                  TONE_ICON_CLASS[meta.tone],
                )}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'truncate text-sm',
                      n.readAt ? 'text-ink-secondary' : 'font-medium text-ink',
                    )}
                  >
                    {n.title}
                  </span>
                  {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-info" />}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-tertiary tabular">
                    {formatDateTime(n.createdAt)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-secondary">
                  {n.content}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 pt-1 text-xs text-ink-tertiary">
        <span>点击一条即标记已读</span>
        <Link href="/requests" className="inline-flex items-center gap-1 hover:text-ink">
          去处理领取申请
        </Link>
      </div>
    </div>
  );
}
