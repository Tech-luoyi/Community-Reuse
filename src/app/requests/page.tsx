'use client';

import { Check, Inbox, Loader2, Phone, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { claimStatusMeta, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge, Button, EmptyState, SectionTitle, Skeleton } from '@/components/ui';
import type { ClaimDto } from '@/shared/types';

export default function RequestsPage() {
  const [tab, setTab] = useState<'applied' | 'received'>('applied');
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-claims', tab],
    queryFn: () => get<ClaimDto[]>('/api/me/claims', { as: tab }),
  });

  async function act(path: string, key: string, msg: string) {
    setBusy(key);
    try {
      await post(path);
      await qc.invalidateQueries({ queryKey: ['my-claims'] });
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  const claims = data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionTitle
        kicker="交易"
        title="我的领取请求"
        desc="「我发起的」可以取消；「我收到的」可以接受、拒绝或完成交接。"
      />

      {/*
        上一版是 `bg-stone-900` 滑动药丸（framer-motion layoutId）+ `🙋 / 📥` emoji。
        列表项本身已有状态色，再给切换器加重深色块会出现两个"主按钮"。
        现在用普通分段控件，选中态只有白底 + 边框。
      */}
      <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
        {(
          [
            ['applied', '我发起的'],
            ['received', '我收到的'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            aria-pressed={tab === v}
            className={cn(
              'h-8 rounded-sm px-3.5 text-[13px] transition-colors',
              tab === v
                ? 'bg-surface-sunken font-medium text-ink'
                : 'text-ink-secondary hover:text-ink',
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <EmptyState
          icon={tab === 'applied' ? <Send size={18} /> : <Inbox size={18} />}
          title="暂无请求"
          hint={
            tab === 'applied'
              ? '在发现页找到心仪的物品，点「我想要」就会出现在这里。'
              : '发布一件闲置，坐等邻居点想要。'
          }
        />
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => {
            const status = claimStatusMeta(c.status);
            const canceled = c.status === 'CANCELED' || c.status === 'REJECTED';
            return (
              <li key={c.id} className="rounded-lg border border-line bg-surface p-3.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-[11px] font-medium text-ink-secondary">
                    {c.applicant.nickname.slice(0, 1)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {c.applicant.nickname}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-tertiary tabular">
                    {formatDateTime(c.createdAt)}
                  </span>
                  <Badge tone={status.tone} className="ml-auto">
                    {status.label}
                  </Badge>
                </div>

                {c.message && (
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
                    “{c.message}”
                  </p>
                )}

                {/*
                  联系方式：接受后互可见。已接受/已完成但对方没填时，
                  要明确说"没填"而不是留白 —— 空白会被读成"还没解锁"。
                */}
                {c.contactText ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-available-bg px-2.5 py-1.5 text-xs text-available">
                    <Phone size={12} />
                    {c.contactText}
                  </p>
                ) : (
                  c.status === 'ACCEPTED' &&
                  !canceled && (
                    <p className="mt-2 rounded-md bg-surface-sunken px-2.5 py-1.5 text-xs text-ink-tertiary">
                      对方未填写联系方式
                    </p>
                  )
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tab === 'applied' && (c.status === 'PENDING' || c.status === 'ACCEPTED') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => act(`/api/claims/${c.id}/cancel`, c.id, '已取消预约')}
                    >
                      {busy === c.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <X size={13} />
                      )}
                      取消
                    </Button>
                  )}
                  {tab === 'received' && c.status === 'PENDING' && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          act(`/api/claims/${c.id}/accept`, c.id + 'a', '已接受，物品转为待面交')
                        }
                      >
                        <Check size={13} /> 接受
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => act(`/api/claims/${c.id}/reject`, c.id + 'r', '已拒绝')}
                      >
                        <X size={13} /> 拒绝
                      </Button>
                    </>
                  )}
                  {tab === 'received' && c.status === 'ACCEPTED' && (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        act(`/api/claims/${c.id}/complete`, c.id + 'c', '交接完成，物品已归档')
                      }
                    >
                      确认完成交接
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
