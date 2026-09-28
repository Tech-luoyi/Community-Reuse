import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * 单个统计位。
 *
 * `partial` 是诚实性开关：看板里的社区口径数字是翻 `GET /api/items`（pageSize=100，
 * 硬上限 5 页）算出来的，超出上限时必须显式说明「基于前 N/total 条」，
 * 不能把抽样值当成全量值展示。
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  partial,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  partial?: { loaded: number; total: number };
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface px-4 py-3.5', className)}>
      <div className="label-xs">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tnum text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">
          {value}
        </span>
        {unit && <span className="text-[12px] text-ink-3">{unit}</span>}
      </div>
      {partial && (
        <div className="tnum mt-2 text-[11px] text-warning">
          基于前 {partial.loaded}/{partial.total} 条
        </div>
      )}
      {!partial && hint && <div className="mt-2 text-[11.5px] text-ink-3">{hint}</div>}
    </div>
  );
}
