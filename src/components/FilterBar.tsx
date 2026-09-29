'use client';

import { ArrowDownWideNarrow, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './ui';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const TRADE_TABS = [
  { value: '', label: '全部' },
  { value: 'FREE', label: '免费送' },
  { value: 'PAY_WHATEVER', label: '随便给' },
  { value: 'FIXED_PRICE', label: '标价' },
];

const FRESH_TABS = [
  { value: '', label: '不限时间' },
  { value: 'JUST_LISTED', label: '刚上架' },
  { value: 'NEW', label: '新上架' },
  { value: 'OLDER', label: '更早' },
];

export interface FilterValue {
  q: string;
  tradeType: string;
  freshness: string;
  sort: string;
}

const EMPTY_FILTER: FilterValue = { q: '', tradeType: '', freshness: '', sort: 'latest' };

/** 除关键词外的「已生效」筛选项数量（移动端按钮角标用）。 */
function activeCount(value: FilterValue): number {
  return (
    [value.tradeType, value.freshness].filter((v) => v !== '').length +
    (value.sort !== 'latest' ? 1 : 0)
  );
}

/**
 * 筛选组控件。
 *
 * 上一版这里有三处问题：标签文字里内嵌 emoji（`🎁 免费`、`⚡ 刚上架`），
 * 选中态用 `layoutId` 做弹簧位移动画（一个筛选组常驻一个 `framer-motion`
 * 组件，切换时还要重排），以及一个深色 `bg-stone-900` 排序按钮 —— 排序是
 * 辅助操作，不该比筛选更醒目。现在都是静态类名切换，无动画、无 emoji。
 */
export function FilterBar({
  value,
  onChange,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const set = (patch: Partial<FilterValue>) => onChange({ ...value, ...patch });
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = activeCount(value);

  const pillClass = (active: boolean) =>
    cn(
      'h-8 rounded-full border px-3 text-[13px] transition-colors',
      active
        ? 'border-ink bg-ink text-white'
        : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink',
    );

  const tradeRow = (idSuffix: string) => (
    <div className="flex flex-wrap items-center gap-1.5" key={`trade-${idSuffix}`}>
      {TRADE_TABS.map((t) => (
        <button
          key={t.value}
          onClick={() => set({ tradeType: t.value })}
          aria-pressed={value.tradeType === t.value}
          className={pillClass(value.tradeType === t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const freshRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      {FRESH_TABS.map((t) => (
        <button
          key={t.value}
          onClick={() => set({ freshness: t.value })}
          aria-pressed={value.freshness === t.value}
          className={pillClass(value.freshness === t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const sortRow = (
    <div className="flex items-center gap-2 text-xs text-ink-tertiary">
      <button
        onClick={() => set({ sort: value.sort === 'latest' ? 'oldest' : 'latest' })}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
      >
        <ArrowDownWideNarrow size={13} />
        {value.sort === 'latest' ? '越新越前' : '越老越前'}
      </button>
      <span className="hidden sm:inline">默认按新鲜度排序</span>
      <button
        onClick={() => onChange(EMPTY_FILTER)}
        disabled={pending === 0 && !value.q}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
      >
        <RotateCcw size={12} /> 重置
      </button>
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
          <Input
            value={value.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="搜物品名称或描述"
            className="h-9 pl-9 pr-16"
          />
          {value.q && (
            <button
              onClick={() => set({ q: '' })}
              className="absolute right-1.5 top-1/2 h-6 -translate-y-1/2 rounded-md px-2 text-xs text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              清空
            </button>
          )}
        </div>

        {/* 移动端：筛选项收进 Sheet（设计文档 §6.2）。宽屏隐藏。 */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" className="h-9 shrink-0 gap-1.5 sm:hidden">
              <SlidersHorizontal size={15} />
              筛选
              {pending > 0 && (
                <span className="ml-0.5 grid size-4 place-items-center rounded-full bg-ink text-[10px] font-medium text-white tabular">
                  {pending}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-xl">
            <SheetHeader>
              <SheetTitle className="text-sm font-semibold">筛选与排序</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <div className="space-y-2">
                <div className="text-xs font-medium text-ink-tertiary">交易方式</div>
                {tradeRow('sheet')}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-ink-tertiary">新鲜度</div>
                {freshRow}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-ink-tertiary">排序</div>
                {sortRow}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* 宽屏：筛选项内联展示。移动端隐藏（已进 Sheet）。 */}
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-3 sm:flex">
        {tradeRow('inline')}
        {freshRow}
      </div>
      <div className="hidden border-t border-line pt-3 sm:block">{sortRow}</div>
    </div>
  );
}
