'use client';

import { motion } from 'framer-motion';
import { ArrowDownWideNarrow, RotateCcw, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from './ui';

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

export function FilterBar({
  value,
  onChange,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const set = (patch: Partial<FilterValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3 rounded-3xl border border-stone-200/70 bg-white/80 p-4 shadow-sm">
      <div className="relative">
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
                  layoutId="trade-pill"
                  className="absolute inset-0 rounded-full bg-stone-900"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
        <span className="mx-1 hidden h-5 w-px bg-stone-200 sm:block" />
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
          onClick={() => onChange({ q: '', tradeType: '', freshness: '', sort: 'latest' })}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-stone-100"
        >
          <RotateCcw size={12} /> 重置
        </button>
      </div>
    </div>
  );
}
