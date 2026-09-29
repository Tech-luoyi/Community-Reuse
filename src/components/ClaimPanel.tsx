'use client';

import { Archive, HandHeart, Info, Loader2, MapPin, Phone, Check, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { burst } from '@/lib/confetti';
import { claimStatusMeta, formatDateTime } from '@/lib/format';
import { Badge, Button, Textarea } from './ui';
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
      toast.success('已提交申请，等发布者确认');
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
          <h3 className="text-sm font-medium text-ink">
            谁想要
            <span className="text-ink-tertiary tabular">
              （{loadFailed ? (isFetching ? '…' : '—') : list.length}）
            </span>
          </h3>
          {item.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy === 'archive'}
              onClick={() => act(`/api/items/${item.id}/archive`, 'archive', '已归档，记录保留')}
            >
              {busy === 'archive' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Archive size={13} />
              )}
              标记已送出
            </Button>
          )}
        </div>

        {loadFailed ? (
          <div className="rounded-md border border-danger-line bg-danger-bg p-3 text-[13px] text-danger">
            <p className="flex items-start gap-1.5">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                申请列表加载失败，所以
                <span className="font-medium">无法判断</span>
                有没有人来要过。
              </span>
            </p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => void refetch()}>
              重试
            </Button>
          </div>
        ) : (
          list.length === 0 && (
            <p className="rounded-md bg-surface-sunken p-4 text-center text-[13px] text-ink-secondary">
              暂时没人点「想要」，分享到业主群看看。
            </p>
          )
        )}

        {pending.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-pending">
            <Info size={13} className="mt-px shrink-0" />
            接受其中一个申请会自动拒绝其余待处理申请（单事务 + 行锁）。
          </p>
        )}

        <ul className="space-y-2">
          {list.map((c) => {
            const status = claimStatusMeta(c.status);
            return (
              <li key={c.id} className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-[11px] font-medium text-ink-secondary">
                    {c.applicant.nickname.slice(0, 1)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {c.applicant.nickname}
                  </span>
                  <Badge tone={status.tone} className="ml-auto">
                    {status.label}
                  </Badge>
                </div>

                {c.message && (
                  <p className="mt-1.5 text-[13px] text-ink-secondary">“{c.message}”</p>
                )}

                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-tertiary">
                  <span className="tabular">{formatDateTime(c.createdAt)}</span>
                  {c.preferredLocation && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={11} />
                      {c.preferredLocation}
                    </span>
                  )}
                </p>

                {c.contactText && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-available-bg px-2.5 py-1.5 text-xs text-available">
                    <Phone size={12} />
                    {c.contactText}
                  </p>
                )}

                <div className="mt-2.5 flex gap-1.5">
                  {c.status === 'PENDING' && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            `/api/claims/${c.id}/accept`,
                            c.id + 'a',
                            '已接受，物品转为待面交',
                            true,
                          )
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
                  {c.status === 'ACCEPTED' && (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `/api/claims/${c.id}/complete`,
                          c.id + 'c',
                          '交接完成，物品已归档',
                          true,
                        )
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
      </div>
    );
  }

  if (!item.viewer.canClaim) {
    return (
      <div className="rounded-md bg-surface-sunken p-4 text-center text-[13px] text-ink-secondary">
        {item.status === 'ARCHIVED'
          ? '该物品已送出，可查看但不可操作。'
          : '这是你自己的物品，坐等邻居点「想要」吧。'}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-surface p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <HandHeart size={15} className="text-ink-tertiary" /> 表达「想要」
      </h3>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="给发布者捎句话，如：今晚 7 点 3 栋楼下自提可以吗？"
        rows={2}
        maxLength={500}
      />
      <Button className="w-full" disabled={busy === 'want'} onClick={want}>
        {busy === 'want' ? <Loader2 size={15} className="animate-spin" /> : <HandHeart size={15} />}
        我想要
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-tertiary">
        对方接受后你们互可见联系方式；接受是单事务，不会出现两人同时被接受。
      </p>
    </div>
  );
}
