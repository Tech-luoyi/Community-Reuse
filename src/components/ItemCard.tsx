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
      className="group reveal-up flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[transform,box-shadow,border-color] duration-300 ease-spring hover:-translate-y-1 hover:border-line-strong hover:shadow-card-hover focus-visible:-translate-y-1"
    >
      {/*
        图片区。视觉重心在这里 —— 这是一个靠照片判断能不能要的 app，
        所以给图片三层处理：
        ① 内描边 ring-inset：让照片边缘和卡片有一个 1px 收口，照片不「贴」在卡片上；
        ② 三段式压暗：底部信息条要放白字，压暗必须够深，但顶部要完全透明不脏照片；
        ③ 悬停时缓慢推近 + 轻微提亮。推近走独立 scale 属性而不是 transform 简写，
           这样不会被 hover 时其他 transform 覆盖。
      */}
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-sunken ring-1 ring-inset ring-black/[0.04]">
        {item.coverUrl && coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.coverUrl}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setCoverOk(false)}
            className="size-full object-cover transition-[scale,filter] duration-700 ease-out-expo group-hover:scale-[1.06] group-hover:brightness-[1.04]"
          />
        ) : (
          // 无图占位：给一点径向高光，而不是一块死板的纯色。仍然只用中性色，
          // 不猜内容长什么样 —— 颜色不该替内容说话。
          <span className="grid size-full place-items-center bg-[radial-gradient(60%_60%_at_50%_40%,rgb(255_255_255/0.7),transparent)]">
            <Package size={28} strokeWidth={1.5} className="text-ink-tertiary" />
          </span>
        )}

        <div className="absolute left-3 top-3">
          <Badge
            tone={freshnessTone(item.freshness.code)}
            className="border-white/50 bg-white/85 shadow-sm backdrop-blur-md"
          >
            {item.freshness.label}
          </Badge>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-3 pb-2.5 pt-10 text-2xs text-white/95">
          <span>{TRADE_TYPE_LABEL[item.tradeType]}</span>
          <span aria-hidden className="text-white/45">
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
