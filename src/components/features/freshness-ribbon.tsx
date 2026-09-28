import * as React from 'react';

import { useInViewOnce } from '@/hooks/use-in-view-once';
import { cn } from '@/lib/cn';
import type { FreshnessCode } from '@/shared/types';

/**
 * 新鲜度构成条。
 *
 * `code` 与 `label` 都由服务端在同一条 SQL 里以 DB now() 算出（契约 §2），
 * 前端**绝不自己重算时间差**，否则两处口径必然漂移。
 * 三段用同一色相的浓度差区分，不引入第二个色相。
 */
const TINT: Record<FreshnessCode, string> = {
  JUST_LISTED: 'bg-accent',
  NEW: 'bg-accent/45',
  OLDER: 'bg-accent/18',
};

export interface FreshnessSegment {
  code: FreshnessCode;
  label: string;
  count: number;
}

export function FreshnessRibbon({
  segments,
  className,
}: {
  segments: FreshnessSegment[];
  className?: string;
}) {
  const { ref, shown } = useInViewOnce<HTMLElement>();
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);

  if (total === 0) {
    return (
      <p className={cn('py-6 text-center text-[12.5px] text-ink-3', className)}>暂无在架物品</p>
    );
  }

  return (
    <figure ref={ref} className={cn('m-0', className)}>
      <div
        role="img"
        aria-label={segments
          .filter((segment) => segment.count > 0)
          .map((segment) => `${segment.label} ${segment.count} 件`)
          .join('，')}
        className="flex h-2 overflow-hidden rounded-xs bg-sunken"
      >
        {/* 宽度从 0 长到目标值并按段递延，读起来是整条带子从左往右被填满；
            不用 scaleX，因为那会让相邻段之间露出缝隙。 */}
        {segments.map((segment, index) =>
          segment.count === 0 ? null : (
            <span
              key={segment.code}
              className={cn(
                'h-full ease-out transition-[width] duration-[260ms]',
                TINT[segment.code],
              )}
              style={{
                width: shown ? `${(segment.count / total) * 100}%` : '0%',
                transitionDelay: `${index * 70}ms`,
              }}
            />
          ),
        )}
      </div>

      <figcaption className="stagger mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <span key={segment.code} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', TINT[segment.code])}
              aria-hidden
            />
            {segment.label}
            <span className="tnum text-ink-3">{segment.count}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
