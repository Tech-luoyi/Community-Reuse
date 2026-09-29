'use client';

import { motion } from 'framer-motion';
import { ArrowDownWideNarrow, RotateCcw, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './ui';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const TRADE_TABS = [
  { value: '', label: '全部' },
  { value: 'FREE', label: '🎁 免费' },
  { value: 'PAY_WHATEVER', label: '☕ 随便给' },
  { value: 'FIXED_PRICE', label: '🏷️ 标价' },
];

const FRESH_TABS = [
  { value: '', label: '不限时间' },
  { value: 'JUST_LISTED', label: '⚡ 刚上架' },
  { value: 'NEW', label: '✨ 新上架' },
  { value: 'OLDER', label: '📚 更早' },
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

  const tradeRow = (idSuffix: string) => (
    <div className="flex flex-wrap items-center gap-2">
      {TRADE_TABS.map((t) => {
        const active = value.tradeType === t.value;
        return (
          <button
            key={t.value}
            onClick={() => set({ tradeType: t.value })}
            className={cn(
              'relative rounded-full px-3.5 py-1.5 text-[13px] font-bold transition',
              active ? 'text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
            )}
          >
            {active && (
              <motion.span
                layoutId={`trade-pill-${idSuffix}`}
                className="absolute inset-0 rounded-full bg-stone-900"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  const freshRow = (
    <div className="flex flex-wrap items-center gap-2">
      {FRESH_TABS.map((t) => {
        const active = value.freshness === t.value;
        return (
          <button
            key={t.value}
            onClick={() => set({ freshness: t.value })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-bold transition',
              active
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-stone-200 text-stone-500 hover:border-stone-300',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const sortRow = (
    <div className="flex items-center gap-2 text-xs font-bold text-stone-500">
      <button
        onClick={() => set({ sort: value.sort === 'latest' ? 'oldest' : 'latest' })}
        className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1.5 text-white transition hover:bg-emerald-700"
      >
        <ArrowDownWideNarrow size={14} />
        {value.sort === 'latest' ? '越新越前' : '越老越前'}
      </button>
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
        <Sparkles size={12} /> 新鲜度即时间序
      </span>
      <button
        onClick={() => onChange(EMPTY_FILTER)}
        className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-stone-100"
      >
        <RotateCcw size={12} /> 重置
      </button>
    </div>
  );

  return (
    <div className="space-y-3 rounded-3xl border border-stone-200/70 bg-white/80 p-4 shadow-sm">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-400"
          />
          <Input
            value={value.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="搜婴儿车、电磁炉、绿植…试试「书」"
            className="h-12 rounded-2xl pl-11 text-[15px]"
          />
          {value.q && (
            <button
              onClick={() => set({ q: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-500 hover:bg-stone-200"
            >
              清空
            </button>
          )}
        </div>

        {/* 移动端：筛选项收进 Sheet（设计文档 §6.2）。宽屏隐藏。 */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              className="h-12 shrink-0 gap-2 rounded-2xl px-4 text-sm font-bold sm:hidden"
            >
              <SlidersHorizontal size={16} />
              筛选
              {pending > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1 text-[11px] font-black text-white">
                  {pending}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-3xl">
            <SheetHeader>
              <SheetTitle className="text-base font-black">筛选与排序</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4">
              <div className="space-y-2">
                <div className="text-xs font-bold text-stone-500">交易方式</div>
                {tradeRow('sheet')}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-bold text-stone-500">新鲜度</div>
                {freshRow}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-bold text-stone-500">排序</div>
                {sortRow}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* 宽屏：筛选项内联展示。移动端隐藏（已进 Sheet）。 */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {tradeRow('inline')}
        <span className="mx-1 h-5 w-px bg-stone-200" />
        {freshRow}
      </div>
      <div className="hidden sm:block">{sortRow}</div>
    </div>
  );
}
