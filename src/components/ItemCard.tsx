'use client';

import Link from 'next/link';
import { MessageCircle, Package, Send } from 'lucide-react';
import { useState } from 'react';
import { formatAgeHours, formatPrice, freshnessTone, TRADE_TYPE_LABEL } from '@/lib/format';
import { Badge } from './ui';
import type { ItemDto } from '@/shared/types';

/**
 * 列表卡片。
 *
 * 上一版的三个问题：
 * 1. 无图占位用 4 套彩色渐变轮流上，一屏 12 张卡出现 4 种粉紫橙绿，
 *    颜色在替内容说话。现在统一中性底 + 图标，不猜内容长什么样。
 * 2. 右上角那个心形是纯装饰（列表 DTO 不带 `viewer`，点不了），
 *    它的存在只是让人以为卡片可收藏。现在删掉 —— 收藏在详情页发生。
 * 3. 价格用 `bg-emerald-50` 底 + `font-black`。价格需要能读，不需要喊。
 */
export function ItemCard({ item }: { item: ItemDto }) {
  const [coverOk, setCoverOk] = useState(true);

  return (
    <Link
      href={`/items/${item.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[transform,box-shadow,border-color] duration-300 ease-spring hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover focus-visible:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-sunken">
        {item.coverUrl && coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.coverUrl}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setCoverOk(false)}
            // 悬停时缓慢放大 1.04：这是让静态卡片"活过来"最便宜的手法。
            // 放大的是 img 本身（overflow-hidden 裁掉溢出），所以不会撑破布局。
            className="size-full object-cover transition-transform duration-500 ease-out-expo group-hover:scale-[1.04]"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <Package size={28} strokeWidth={1.5} className="text-ink-tertiary" />
          </span>
        )}

        <div className="absolute left-3 top-3">
          <Badge tone={freshnessTone(item.freshness.code)} className="bg-white/88 backdrop-blur-sm">
            {item.freshness.label}
          </Badge>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-8 text-2xs text-white/95">
          <span>{TRADE_TYPE_LABEL[item.tradeType]}</span>
          <span aria-hidden className="text-white/40">
            ·
          </span>
          <span>{formatAgeHours(item.freshness.ageHours)}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-1 text-sm font-medium text-ink">{item.name}</h3>
          <span className="shrink-0 text-sm font-semibold text-ink tabular">
            {formatPrice(item.price, item.tradeType)}
          </span>
        </div>

        <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-ink-secondary">
          {item.description}
        </p>

        <div className="mt-1 flex items-center justify-between border-t border-line pt-3 text-2xs text-ink-tertiary">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-sunken text-2xs font-medium text-ink-secondary">
              {item.owner.nickname.slice(0, 1)}
            </span>
            <span className="truncate">{item.owner.nickname}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3 tabular">
            <span className="inline-flex items-center gap-1">
              <Send size={12} />
              {item.claimCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={12} />
              {item.favoriteCount}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
