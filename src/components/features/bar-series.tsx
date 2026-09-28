import * as React from 'react';

import { useInViewOnce } from '@/hooks/use-in-view-once';
import { cn } from '@/lib/cn';

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * 分布条。
 *
 * 用 `width: N%` 的 div 而不是 SVG：不需要处理 `preserveAspectRatio` 带来的文字拉伸，
 * 亚像素对齐由浏览器负责，条宽变化也不会让描边变糊。
 * 条宽按**最大值**归一（最长条占满轨道），比按总和归一更易读；
 * 占比信息放在数值列里单独给出。
 *
 * 一个系列只用一个色相（accent 0.85），绝不做彩虹分类色。
 */
export function BarSeries({
  data,
  total,
  unit = '件',
  emptyHint = '暂无可统计的数据',
  className,
}: {
  data: BarDatum[];
  /** 传了就额外给出占比；分母为 0 时不显示百分比而不是显示 NaN。 */
  total?: number;
  unit?: string;
  emptyHint?: string;
  className?: string;
}) {
  const { ref, shown } = useInViewOnce<HTMLDivElement>();

  if (data.length === 0) {
    return (
      <p className={cn('py-6 text-center text-[12.5px] text-ink-3', className)}>{emptyHint}</p>
    );
  }

  const max = data.reduce((acc, datum) => Math.max(acc, datum.value), 0);
  const shareBase = total !== undefined && total > 0 ? total : undefined;

  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-2.5', className)}
      role="img"
      data-shown={shown}
      aria-label={data.map((d) => `${d.label} ${d.value}${unit}`).join('，')}
    >
      {data.map((datum, index) => {
        const width = max > 0 ? (datum.value / max) * 100 : 0;
        const share = shareBase === undefined ? null : (datum.value / shareBase) * 100;
        return (
          <div
            key={datum.label}
            className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3"
          >
            <span className="truncate text-[12.5px] text-ink-2" title={datum.label}>
              {datum.label}
            </span>
            <span className="block h-1.5 overflow-hidden rounded-xs bg-sunken">
              <span
                className="draw-x block h-full rounded-xs bg-accent/85"
                style={{ width: `${width}%`, transitionDelay: `${index * 45}ms` }}
              />
            </span>
            <span className="tnum flex items-baseline gap-1.5 text-[12.5px] font-medium text-ink">
              {datum.value}
              <span className="text-[11px] font-normal text-ink-3">
                {share === null ? unit : `${share.toFixed(0)}%`}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
