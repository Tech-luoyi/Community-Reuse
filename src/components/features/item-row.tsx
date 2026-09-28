import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { CoverPlate } from '@/components/ui/cover-plate';
import { Badge, StatusChip } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import {
  FRESHNESS_TONE,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_TONE,
  formatAgeHours,
  formatPrice,
} from '@/lib/format';
import type { ItemDto } from '@/shared/types';

function Sep() {
  return (
    <span aria-hidden className="text-ink-3/50">
      ·
    </span>
  );
}

/**
 * 集市列表行：单列密集行表，不是卡片网格。
 *
 * 密集行表能在一屏里放下更多物品，也更接近「工具」而不是「商城首页」。
 * 三条纪律：
 * · `ACTIVE` 不渲染状态徽标 —— 它是列表默认筛选值，每行都点一个亮色等于没有重点；
 * · 不显示 `favoriteCount` —— 收藏接口缺失、种子 0 行，展示出来只会读成 bug；
 * · 新鲜度直接取服务端 `freshness.label`，前端不重算时间差。
 */
export function ItemRow({ item, className }: { item: ItemDto; className?: string }) {
  const showStatus = item.status !== 'ACTIVE';

  return (
    <Link
      href={`/items/${item.id}`}
      className={cn(
        'group/row flex gap-4 px-5 py-3.5 ease-out',
        'transition-colors duration-[170ms] hover:bg-sunken/60 active:bg-sunken',
        className,
      )}
    >
      <CoverPlate
        src={item.coverUrl}
        name={item.name}
        category={item.category}
        size="sm"
        className="ease-out transition-[box-shadow] duration-[170ms] group-hover/row:ring-line-strong"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <h3 className="min-w-0 flex-1 truncate text-[16px] leading-[1.35] font-semibold tracking-[-0.011em] text-ink">
            {item.name}
          </h3>
          <Badge tone={FRESHNESS_TONE[item.freshness.code]} className="mt-0.5">
            {item.freshness.label}
          </Badge>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
          <span>{item.category ?? '未分类'}</span>
          <Sep />
          <span className="max-w-[12rem] truncate">{item.owner.nickname}</span>
          <Sep />
          <span className="tnum">{formatAgeHours(item.freshness.ageHours)}</span>
          {item.claimCount > 0 && (
            <>
              <Sep />
              <span className="tnum">{item.claimCount} 人申请</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-1.5">
        <span className="tnum text-[15px] leading-none font-semibold text-ink">
          {formatPrice(item.price, item.tradeType)}
        </span>
        {showStatus && (
          <StatusChip tone={ITEM_STATUS_TONE[item.status]}>
            {ITEM_STATUS_LABEL[item.status]}
          </StatusChip>
        )}
      </div>

      {/* 悬浮才现身的箭头：槽位常驻（w-4），所以出现时不推挤任何文字。
          移动端不渲染 —— 没有 hover，那 20px 只会白占宽度。 */}
      <span className="hidden w-4 shrink-0 place-items-center self-center sm:grid" aria-hidden>
        <ArrowRight
          size={15}
          strokeWidth={1.75}
          className={cn(
            'text-ink-3 ease-out transition-[opacity,transform] duration-[170ms]',
            'opacity-0 -translate-x-1 group-hover/row:translate-x-0 group-hover/row:opacity-100',
          )}
        />
      </span>
    </Link>
  );
}
