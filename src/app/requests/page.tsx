'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button, EmptyState, SectionTitle, Skeleton } from '@/components/ui';
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
        title={
          <>
            我的领取<span className="text-emerald-600">请求</span>
          </>
        }
        desc="左：我发起的（可取消）；右：我收到的（可接受 / 拒绝 / 完成）。"
      />
      <div className="relative grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
        {(
          [
            ['applied', '🙋 我发起的'],
            ['received', '📥 我收到的'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={cn(
              'relative rounded-xl py-2.5 text-sm font-black transition',
              tab === v ? 'text-white' : 'text-stone-500',
            )}
          >
            {tab === v && (
              <motion.span
                layoutId="req-tab"
                className="absolute inset-0 rounded-xl bg-stone-900"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{l}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <EmptyState
          emoji={tab === 'applied' ? '🙋' : '📥'}
          title="暂无请求"
          hint={
            tab === 'applied'
              ? '去发现页点一件心仪物品的“我想要”吧。'
              : '发布一件闲置，坐等邻居点想要。'
          }
        />
      ) : (
        <AnimatePresence initial={false}>
          {claims.map((c) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="rounded-3xl border border-stone-200/70 bg-white/90 p-4"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-stone-900 text-xs text-white">
                  {c.applicant.nickname.slice(0, 1)}
                </span>
                <span className="font-black">{c.applicant.nickname}</span>
                <span className="text-xs text-stone-400">· {formatDateTime(c.createdAt)}</span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black ${c.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : c.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-700' : c.status === 'COMPLETED' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'}`}
                >
                  {c.status}
                </span>
              </div>
              {c.message && <p className="mt-2 text-sm text-stone-600">“{c.message}”</p>}
              {c.contactText && (
                <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                  📞 对方联系方式：{c.contactText}
                </p>
              )}
              {!c.contactText && (c.status === 'ACCEPTED' || c.status === 'COMPLETED') && (
                <p className="mt-2 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-500">
                  对方未填写联系方式
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tab === 'applied' && (c.status === 'PENDING' || c.status === 'ACCEPTED') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => act(`/api/claims/${c.id}/cancel`, c.id, '已取消预约')}
                  >
                    {busy === c.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <X size={14} />
                    )}{' '}
                    取消
                  </Button>
                )}
                {tab === 'received' && c.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      variant="accent"
                      disabled={busy !== null}
                      onClick={() => act(`/api/claims/${c.id}/accept`, c.id + 'a', '已接受 🎉')}
                    >
                      <Check size={14} /> 接受
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => act(`/api/claims/${c.id}/reject`, c.id + 'r', '已拒绝')}
                    >
                      <X size={14} /> 拒绝
                    </Button>
                  </>
                )}
                {tab === 'received' && c.status === 'ACCEPTED' && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy !== null}
                    onClick={() => act(`/api/claims/${c.id}/complete`, c.id + 'c', '交接完成 ✅')}
                  >
                    确认完成交接
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
