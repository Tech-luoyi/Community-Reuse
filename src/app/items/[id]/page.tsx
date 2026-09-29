'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CalendarClock, Heart } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { PENDING_ENDPOINTS } from '@/lib/pending';
import {
  formatAgeHours,
  formatDateTime,
  formatPrice,
  freshnessStyle,
  TRADE_TYPE_LABEL,
} from '@/lib/format';
import { Badge, Button, Card, EmptyState, PendingApi } from '@/components/ui';
import { ClaimPanel } from '@/components/ClaimPanel';
import { FaqAssistant } from '@/components/ai';
import type { ItemDetailDto } from '@/shared/types';

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [imgIdx, setImgIdx] = useState(0);
  const [failedImgs, setFailedImgs] = useState<string[]>([]);

  const {
    data: item,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['item', id],
    queryFn: () => get<ItemDetailDto>(`/api/items/${id}`),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="h-96 animate-pulse rounded-3xl bg-stone-200/70" />
        <div className="space-y-3">
          <div className="h-8 w-2/3 animate-pulse rounded-xl bg-stone-200/70" />
          <div className="h-24 animate-pulse rounded-2xl bg-stone-200/70" />
          <div className="h-40 animate-pulse rounded-2xl bg-stone-200/70" />
        </div>
      </div>
    );
  }

  if (isError || !item) {
    return (
      <EmptyState
        emoji="🔍"
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

  return (
    <div className="space-y-4">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm font-bold text-stone-500 transition hover:text-stone-900"
      >
        <ArrowLeft size={16} /> 返回
      </button>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="space-y-3">
          <Card className="relative overflow-hidden p-0">
            <div className="relative aspect-[4/3] bg-gradient-to-br from-emerald-100 via-amber-50 to-sky-100">
              {coverUrl && coverOk ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={coverUrl}
                  src={coverUrl}
                  alt={item.name}
                  onError={() =>
                    setFailedImgs((f) => (f.includes(coverUrl) ? f : [...f, coverUrl]))
                  }
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-8xl">📦</div>
              )}
              <div className="absolute left-4 top-4 flex gap-1.5">
                <Badge className={freshnessStyle(item.freshness.code)}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {item.freshness.label} · {formatAgeHours(item.freshness.ageHours)}
                </Badge>
                <Badge className="bg-black/55 text-white">{item.status}</Badge>
              </div>
              {/*
                收藏态取自服务端真实字段 `viewer.isFavorite`，不维护本地假状态：
                `POST/DELETE /api/items/:id/favorite`（契约 §6）尚未实现，
                点亮后又随刷新消失的爱心比没有爱心更糟。接口就位后去掉 disabled 即可。
              */}
              <button
                disabled
                title="收藏接口待联调（api-contract.md §6）"
                aria-label="收藏"
                className="absolute right-4 top-4 grid h-10 w-10 cursor-not-allowed place-items-center rounded-full bg-white/85 text-stone-400"
              >
                <Heart size={18} fill={item.viewer.isFavorite ? 'currentColor' : 'none'} />
              </button>
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-3 no-scrollbar">
                {images.map((im, i) => (
                  <button
                    key={im.url + i}
                    onClick={() => setImgIdx(i)}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${i === imgIdx ? 'border-emerald-500' : 'border-transparent opacity-60'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight">{item.name}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span>👤 {item.owner.nickname}</span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock size={12} /> {formatDateTime(item.publishedAt)} 发布
                  </span>
                  {item.category && (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 font-bold">
                      #{item.category}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <div className="rounded-2xl bg-emerald-50 px-3 py-1.5 text-xl font-black text-emerald-700">
                  {formatPrice(item.price, item.tradeType)}
                </div>
                <div className="mt-1 text-xs font-bold text-stone-500">
                  {TRADE_TYPE_LABEL[item.tradeType]}
                </div>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-600">
              {item.description}
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-black">💬 公开留言板</h3>
            <PendingApi
              endpoint={PENDING_ENDPOINTS.itemMessages}
              section="§5"
              note="留言板把重复私聊（「还在吗」「几成新」）沉淀成物品下的公共问答；按契约 FAQ 生成的回复只允许发布者一键发进这里。"
            />
          </Card>
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <Card className="p-5">
                <ClaimPanel item={item} />
              </Card>
            </motion.div>
          </AnimatePresence>
          {item.viewer.isOwner && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 }}
            >
              <FaqAssistant itemId={item.id} tradeType={item.tradeType} />
            </motion.div>
          )}
          <Card className="p-4 text-xs leading-relaxed text-stone-500">
            <span className="font-black text-stone-700">🔒 隐私设计 D1：</span>
            详情页永不返回联系方式；只有当领取申请进入{' '}
            <code className="font-mono">ACCEPTED / COMPLETED</code>{' '}
            后，交易对手方才能在申请卡片里看到对方电话/微信。
          </Card>
          <Link
            href="/"
            className="block text-center text-xs font-bold text-stone-400 hover:text-stone-700"
          >
            看看别的物品 →
          </Link>
        </div>
      </div>
    </div>
  );
}
