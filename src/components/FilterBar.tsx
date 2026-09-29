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
 *
 * 新增 `query` prop：**输入框的显示值与真正生效的搜索词分离**。
 * 调用方（首页）把 `q` 防抖后再传进来，于是打字时框里的字立刻动、列表不跟着抖。
 * 不这么做的话每敲一个字就发一次请求，中文输入法拼音组合态还会多打一次。
 * 不传 `query` 时退化成原来的同步行为。
 */
export function FilterBar({
  value,
  onChange,
  query,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  /** 已防抖的生效值；缺省时用 `value.q`。 */
  query?: string;
}) {
  const set = (patch: Partial<FilterValue>) => onChange({ ...value, ...patch });
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = activeCount(value);
  const searching = query !== undefined && query !== value.q;

  const pillClass = (active: boolean) =>
    cn(
      // 选中态是「按下的胶囊」：贴一点地、给一道 inset 高光，而不是纯色块。
      // 未选中只有边框，悬停才浮起来一点。三档高度差让当前筛选项一眼可辨。
      'h-8 rounded-full border px-3 text-sm transition-[color,background-color,border-color,box-shadow] duration-200',
      active
        ? 'border-ink bg-ink text-ink-inverse shadow-sm'
        : 'border-line bg-surface text-ink-secondary shadow-xs hover:border-line-strong hover:text-ink hover:shadow-sm',
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
    <div className="flex items-center gap-2 text-2xs text-ink-tertiary">
      <button
        onClick={() => set({ sort: value.sort === 'latest' ? 'oldest' : 'latest' })}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm text-ink-secondary shadow-xs transition-[box-shadow,background-color,border-color] duration-200 hover:border-line-strong hover:text-ink hover:shadow-sm"
      >
        <ArrowDownWideNarrow size={13} />
        {value.sort === 'latest' ? '越新越前' : '越老越前'}
      </button>
      <span className="hidden sm:inline">默认按新鲜度排序</span>
      <button
        onClick={() => onChange(EMPTY_FILTER)}
        disabled={pending === 0 && !value.q}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
      >
        <RotateCcw size={12} /> 重置
      </button>
    </div>
  );

  return (
    // 筛选区是一块「工具面板」，不是内容卡片：贴地阴影 + 稍紧的圆角。
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3.5 shadow-card">
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
            aria-label="搜物品名称或描述"
            className="h-9 pl-9 pr-16"
          />
          {searching && (
            /* 防抖窗口内：告诉用户「已经收到了，正在找」，而不是让列表静默不动。 */
            <span
              className="absolute right-9 top-1/2 -translate-y-1/2 text-2xs text-ink-tertiary"
              aria-live="polite"
            >
              搜索中
            </span>
          )}
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
                <span className="ml-0.5 grid size-4 place-items-center rounded-full bg-ink text-[10px] font-medium text-ink-inverse tabular">
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
      <div className="hidden border-t border-line/80 pt-3.5 sm:block">{sortRow}</div>
    </div>
  );
}
