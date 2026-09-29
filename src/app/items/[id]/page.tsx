'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  Heart,
  Lock,
  MessagesSquare,
  Package,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { del, get, post } from '@/lib/api';
import {
  formatAgeHours,
  formatDateTime,
  formatPrice,
  freshnessTone,
  itemStatusMeta,
  TRADE_TYPE_LABEL,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { ClaimPanel } from '@/components/ClaimPanel';
import { FaqAssistant } from '@/components/ai';
import { MessageBoard } from '@/components/MessageBoard';
import type { FavoriteResult } from '@/shared/schemas';
import type { ItemDetailDto } from '@/shared/types';

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [imgIdx, setImgIdx] = useState(0);
  const [failedImgs, setFailedImgs] = useState<string[]>([]);
  const [favPending, setFavPending] = useState(false);

  const {
    data: item,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['item', id],
    queryFn: () => get<ItemDetailDto>(`/api/items/${id}`),
  });

  async function toggleFavorite() {
    if (!item) return;
    setFavPending(true);
    try {
      const next = item.viewer.isFavorite;
      const r = next
        ? await del<FavoriteResult>(`/api/items/${id}/favorite`)
        : await post<FavoriteResult>(`/api/items/${id}/favorite`);
      toast.success(r.favorited ? '已加入收藏' : '已取消收藏');
      await qc.invalidateQueries({ queryKey: ['item', id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setFavPending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <Skeleton className="aspect-[4/3] w-full" />
        <div className="space-y-3">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !item) {
    return (
      <EmptyState
        icon={<Search size={18} />}
        title="物品不存在或无权查看"
        hint="可能已被删除，或你不在该社区。"
        action={<Button onClick={() => router.push('/')}>回发现页</Button>}
      />
    );
  }

  const images = item.images.length
    ? item.images
    : item.coverUrl
      ? [{ url: item.coverUrl, sortOrder: 0 }]
      : [];
  const coverUrl = images[imgIdx]?.url;
  const coverOk = !!coverUrl && !failedImgs.includes(coverUrl);
  const status = itemStatusMeta(item.status);

  return (
    <div className="space-y-4">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> 返回
      </button>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="relative aspect-[4/3] bg-surface-sunken">
              {coverUrl && coverOk ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={coverUrl}
                  src={coverUrl}
                  alt={item.name}
                  onError={() =>
                    setFailedImgs((f) => (f.includes(coverUrl) ? f : [...f, coverUrl]))
                  }
                  className="size-full object-cover"
                />
              ) : (
                <span className="grid size-full place-items-center">
                  <Package size={40} strokeWidth={1.25} className="text-ink-tertiary" />
                </span>
              )}

              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                <Badge
                  tone={freshnessTone(item.freshness.code)}
                  className="bg-white/90 backdrop-blur-sm"
                >
                  {item.freshness.label} · {formatAgeHours(item.freshness.ageHours)}
                </Badge>
                <Badge tone={status.tone} className="bg-white/90 backdrop-blur-sm">
                  {status.label}
                </Badge>
              </div>

              <button
                onClick={toggleFavorite}
                disabled={favPending}
                aria-pressed={item.viewer.isFavorite}
                aria-label={item.viewer.isFavorite ? '取消收藏' : '加入收藏'}
                className={cn(
                  'absolute right-3 top-3 grid size-9 place-items-center rounded-md border bg-white/90 backdrop-blur-sm transition-colors disabled:opacity-60',
                  item.viewer.isFavorite
                    ? 'border-danger-line text-danger'
                    : 'border-line text-ink-tertiary',
                )}
              >
                <Heart size={16} fill={item.viewer.isFavorite ? 'currentColor' : 'none'} />
              </button>
            </div>

            {images.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto p-2.5 no-scrollbar">
                {images.map((im, i) => (
                  <button
                    key={im.url + i}
                    onClick={() => setImgIdx(i)}
                    aria-label={`查看第 ${i + 1} 张图`}
                    aria-current={i === imgIdx}
                    className={cn(
                      'size-14 shrink-0 overflow-hidden rounded-md border transition',
                      i === imgIdx
                        ? 'border-ink'
                        : 'border-transparent opacity-60 hover:opacity-100',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold leading-snug tracking-[-0.01em] text-ink">
                  {item.name}
                </h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-tertiary">
                  <span>{item.owner.nickname}</span>
                  <span className="inline-flex items-center gap-1 tabular">
                    <CalendarDays size={12} />
                    {formatDateTime(item.publishedAt)} 发布
                  </span>
                  {item.category && (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5">
                      {item.category}
                    </span>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-semibold tracking-[-0.01em] text-ink tabular">
                  {formatPrice(item.price, item.tradeType)}
                </div>
                <div className="mt-0.5 text-xs text-ink-tertiary">
                  {TRADE_TYPE_LABEL[item.tradeType]}
                </div>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-[1.7] text-ink-secondary">
              {item.description}
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink">
              <MessagesSquare size={15} className="text-ink-tertiary" />
              公开留言板
            </h3>
            <MessageBoard itemId={item.id} />
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-5">
            <ClaimPanel item={item} />
          </Card>

          {item.viewer.isOwner && <FaqAssistant itemId={item.id} />}

          <Card className="flex gap-2 p-4 text-[13px] leading-relaxed text-ink-secondary">
            <Lock size={14} className="mt-0.5 shrink-0 text-ink-tertiary" />
            <p>
              详情页不返回联系方式。只有当领取申请进入「已接受」或「已完成」后，
              交易双方才能在申请卡片里看到对方电话或微信。
            </p>
          </Card>

          <Link
            href="/"
            className="block text-center text-xs text-ink-tertiary transition-colors hover:text-ink"
          >
            看看别的物品
          </Link>
        </div>
      </div>
    </div>
  );
}
