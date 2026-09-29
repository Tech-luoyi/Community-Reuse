'use client';

import Link from 'next/link';
import { Heart, MessageCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatAgeHours, formatPrice, freshnessStyle, TRADE_TYPE_LABEL } from '@/lib/format';
import { Badge } from './ui';
import type { ItemDto } from '@/shared/types';

const PLACEHOLDER_GRADIENTS = [
  'from-emerald-200 via-lime-100 to-amber-100',
  'from-orange-200 via-amber-100 to-rose-100',
  'from-sky-200 via-cyan-100 to-emerald-100',
  'from-violet-200 via-purple-100 to-pink-100',
];

/**
 * 列表卡片。
 *
 * 这里原来是一张 `motion.div layout` + 逐卡延迟入场 + 4 层 `backdrop-blur`
 * + `card-grain`（radial-gradient 配 mask-image）+ hover 时 `scale-110 rotate`
 * 与 `0 20px 50px` 巨阴影的组合。一页 12 张卡同时存在时，模糊层与 grain 遮罩
 * 会把合成成本乘上卡片数，是列表滚动掉帧的主因。
 * 现在只留 transform/box-shadow 两条 CSS 过渡（都走合成线程），观感一致但不再逐帧重绘。
 */
export function ItemCard({ item }: { item: ItemDto }) {
  const [coverOk, setCoverOk] = useState(true);
  const grad = PLACEHOLDER_GRADIENTS[item.id.charCodeAt(0) % PLACEHOLDER_GRADIENTS.length];

  return (
    <Link
      href={`/items/${item.id}`}
      className="group relative block overflow-hidden rounded-3xl border border-stone-200/70 bg-white shadow-[0_1px_3px_rgba(28,25,23,.06)] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-stone-300 hover:shadow-[0_10px_24px_rgba(28,25,23,.1)]"
    >
      <div className={cn('relative h-44 overflow-hidden bg-gradient-to-br', grad)}>
        {item.coverUrl && coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.coverUrl}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setCoverOk(false)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-6xl">
            {item.tradeType === 'FREE' ? '🎁' : item.tradeType === 'FIXED_PRICE' ? '🏷️' : '📦'}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/30 to-transparent" />
        <div className="absolute left-3 top-3">
          <Badge className={freshnessStyle(item.freshness.code)}>{item.freshness.label}</Badge>
        </div>
        {/*
          列表 DTO（`ItemDto`）不带 `viewer`，卡片无从知道当前用户是否已收藏，
          所以这里只是一个装饰位，收藏动作在详情页完成（那里有 `viewer.isFavorite`）。
          在卡片上放一个可点的心形，等于承诺一个刷新就会失忆的状态。
        */}
        <span
          aria-hidden
          title="收藏请在物品详情页操作"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/85 text-stone-400"
        >
          <Heart size={17} />
        </span>
        <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5 text-[11px] font-bold text-white">
          <span className="rounded-full bg-black/45 px-2 py-0.5">
            {TRADE_TYPE_LABEL[item.tradeType]}
          </span>
          <span className="rounded-full bg-black/45 px-2 py-0.5">
            {formatAgeHours(item.freshness.ageHours)}
          </span>
        </div>
      </div>

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-[15px] font-black tracking-tight">{item.name}</h3>
          <span className="shrink-0 rounded-xl bg-emerald-50 px-2 py-1 text-sm font-black text-emerald-700">
            {formatPrice(item.price, item.tradeType)}
          </span>
        </div>
        <p className="line-clamp-2 min-h-10 text-[13px] leading-relaxed text-stone-500">
          {item.description}
        </p>
        <div className="flex items-center justify-between border-t border-dashed border-stone-200 pt-2.5 text-xs text-stone-500">
          <span className="flex items-center gap-1 font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-stone-900 text-[10px] text-white">
              {item.owner.nickname.slice(0, 1)}
            </span>
            <span className="max-w-24 truncate">{item.owner.nickname}</span>
          </span>
          <span className="flex items-center gap-2.5 font-bold">
            <span className="inline-flex items-center gap-1">
              <Send size={13} className="text-emerald-600" /> {item.claimCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={13} className="text-orange-500" /> {item.favoriteCount}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
