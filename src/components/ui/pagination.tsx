import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/cn';

type Slot = number | 'gap';

/**
 * 数字分页窗口：首尾恒定可见，当前页左右各留一格，中间用省略号收拢。
 * 不用「加载更多」——总量是服务端已知的确定值，藏起来反而丢失信息。
 */
function pageWindow(current: number, total: number): Slot[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const wanted = [1, total, current - 1, current, current + 1]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const slots: Slot[] = [];
  let previous = 0;
  for (const page of wanted) {
    if (page === previous) continue;
    if (page - previous > 1) slots.push('gap');
    slots.push(page);
    previous = page;
  }
  return slots;
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
  className,
}: {
  page: number;
  totalPages: number;
  /** 命中总数，用来在页码左侧给出「共 N 件」的确定信息。 */
  total?: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) {
    return total === undefined ? null : (
      <div className={cn('px-5 py-3 text-[12px] text-ink-3', className)}>
        共 <span className="tnum text-ink-2">{total}</span> 件
      </div>
    );
  }

  const arrowClass =
    'grid size-7 place-items-center rounded-xs text-ink-2 transition-colors duration-[110ms] ease-out ' +
    'hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-35';

  return (
    <nav
      aria-label="分页"
      className={cn('flex items-center justify-between gap-4 px-5 py-3', className)}
    >
      <span className="text-[12px] text-ink-3">
        {total === undefined ? (
          <>
            第 <span className="tnum text-ink-2">{page}</span> /{' '}
            <span className="tnum text-ink-2">{totalPages}</span> 页
          </>
        ) : (
          <>
            共 <span className="tnum text-ink-2">{total}</span> 件 · 第{' '}
            <span className="tnum text-ink-2">{page}</span> /{' '}
            <span className="tnum text-ink-2">{totalPages}</span> 页
          </>
        )}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className={arrowClass}
        >
          <ChevronLeft size={15} aria-hidden />
        </button>

        {pageWindow(page, totalPages).map((slot, index) =>
          slot === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="grid size-7 place-items-center text-[12px] text-ink-3"
            >
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              aria-label={`第 ${slot} 页`}
              aria-current={slot === page ? 'page' : undefined}
              onClick={() => onChange(slot)}
              className={cn(
                'tnum size-7 rounded-xs text-[12.5px] font-medium transition-colors duration-[110ms] ease-out',
                slot === page ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-sunken hover:text-ink',
              )}
            >
              {slot}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="下一页"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className={arrowClass}
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
