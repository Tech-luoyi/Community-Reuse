'use client';

import { motion } from 'framer-motion';
import { Check, HandHeart, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { burst } from '@/lib/confetti';
import { formatDateTime } from '@/lib/format';
import { Button, Textarea } from './ui';
import type { ClaimDto, ItemDetailDto } from '@/shared/types';

export function ClaimPanel({ item }: { item: ItemDetailDto }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // GET /api/items/:id/claims 是**已实现**的接口，因此这里不能 `.catch(() => [])`：
  // 把 401 / 网络抖动下沉成空数组，等于对发布者谎报「没人想要你的东西」。
  const {
    data: claims,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['claims', item.id],
    queryFn: () => get<ClaimDto[]>(`/api/items/${item.id}/claims`),
    enabled: item.viewer.isOwner,
  });

  async function act(path: string, key: string, success: string, celebrate = false) {
    setBusy(key);
    try {
      await post(path);
      await qc.invalidateQueries({ queryKey: ['item', item.id] });
      await qc.invalidateQueries({ queryKey: ['claims', item.id] });
      if (celebrate) void burst({ particleCount: 90, spread: 70, origin: { y: 0.4 } });
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  async function want() {
    setBusy('want');
    try {
      await post(`/api/items/${item.id}/claims`, { message: message || undefined });
      setMessage('');
      void burst({ particleCount: 60, spread: 60, origin: { y: 0.5 } });
      toast.success('已表达“想要”！等发布者确认 🤝');
      await qc.invalidateQueries({ queryKey: ['item', item.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '申请失败');
    } finally {
      setBusy(null);
    }
  }

  if (item.viewer.isOwner) {
    const loadFailed = isError || claims === undefined;
    const list = claims ?? [];
    const pending = list.filter((c) => c.status === 'PENDING');
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black">
            谁想要{' '}
            <span className="text-emerald-600">
              ({loadFailed ? (isFetching ? '…' : '—') : list.length})
            </span>
          </h3>
          {item.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === 'archive'}
              onClick={() => act(`/api/items/${item.id}/archive`, 'archive', '已归档，记录保留 📦')}
            >
              {busy === 'archive' ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
              标记已送出
            </Button>
          )}
        </div>
        {loadFailed ? (
          <div className="rounded-2xl bg-amber-50 p-4 text-center text-xs text-amber-800">
            {isFetching ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> 申请列表加载中…
              </span>
            ) : (
              <>
                申请列表加载失败，因此
                <b className="font-black">无法判断</b>
                有没有人来要过。
                <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>
                  重试
                </Button>
              </>
            )}
          </div>
        ) : (
          list.length === 0 && (
            <p className="rounded-2xl bg-stone-50 p-4 text-center text-xs text-stone-400">
              暂时没人点“想要”，分享给邻居看看？
            </p>
          )
        )}
        {pending.length > 0 && (
          <p className="text-xs font-bold text-amber-700">
            ⚠️ 接受一个申请会自动拒绝其余待处理申请（单事务 + 行锁）。
          </p>
        )}
        <div className="space-y-2">
          {list.map((c) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-stone-200/70 bg-white p-3"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-stone-900 text-xs text-white">
                  {c.applicant.nickname.slice(0, 1)}
                </span>
                <span className="font-black">{c.applicant.nickname}</span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black ${c.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : c.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-700' : c.status === 'COMPLETED' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'}`}
                >
                  {c.status}
                </span>
              </div>
              {c.message && <p className="mt-1.5 text-[13px] text-stone-600">“{c.message}”</p>}
              <p className="mt-1 text-[11px] text-stone-400">
                {formatDateTime(c.createdAt)}
                {c.preferredLocation ? ` · 📍${c.preferredLocation}` : ''}
              </p>
              {c.contactText && (
                <p className="mt-1.5 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-800">
                  📞 {c.contactText}
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                {c.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      variant="accent"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `/api/claims/${c.id}/accept`,
                          c.id + 'a',
                          '已接受，物品变为 RESERVED 🎉',
                          true,
                        )
                      }
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
                {c.status === 'ACCEPTED' && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy !== null}
                    onClick={() =>
                      act(`/api/claims/${c.id}/complete`, c.id + 'c', '交接完成，已归档 ✅', true)
                    }
                  >
                    确认完成交接
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  if (!item.viewer.canClaim) {
    return (
      <div className="rounded-2xl bg-stone-100 p-4 text-center text-xs font-bold text-stone-500">
        {item.status === 'ARCHIVED'
          ? '📦 该物品已归档，可查看但不可操作。'
          : '这是你自己的物品，坐等邻居点“想要”吧～'}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-3xl bg-gradient-to-b from-emerald-50 to-white p-4">
      <h3 className="flex items-center gap-1.5 font-black">
        <HandHeart size={17} className="text-emerald-600" /> 表达“想要”
      </h3>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="给发布者捎句话，如：今晚7点3栋楼下自提可以吗？"
        rows={2}
        maxLength={500}
      />
      <Button variant="accent" className="w-full" disabled={busy === 'want'} onClick={want}>
        {busy === 'want' ? <Loader2 size={16} className="animate-spin" /> : <HandHeart size={16} />}
        我想要，上报申请
      </Button>
      <p className="text-[11px] leading-relaxed text-stone-500">
        对方接受后你们互可见联系方式（D1 裁剪）；接受是单事务，不会出现两人同时被接受。
      </p>
    </div>
  );
}
