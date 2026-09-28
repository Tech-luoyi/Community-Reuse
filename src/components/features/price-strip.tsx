import * as React from 'react';

import { useInViewOnce } from '@/hooks/use-in-view-once';
import { cn } from '@/lib/cn';

/**
 * 成交价 strip plot + 箱线。
 *
 * 刻意不用直方图：种子数据里归档的计价物品只有 2 件，2 根柱子的直方图看起来像坏了，
 * 而 2 道刻度的 strip plot 看起来是「稀疏但正确」。分箱还会把「到底有几件」这个信息藏掉。
 *
 * 全程 HTML/CSS 而非 SVG —— 不需要 `preserveAspectRatio`，1px 刻度天然锐利。
 * 价格轴**强制从 0 起**：截断的价格轴会夸大差异，是图表里最常见的误导。
 */
export interface PricePoint {
  id: string;
  price: number;
  /** 悬浮提示用，缺省则只显示价格。 */
  label?: string | null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const lower = sorted[base];
  if (lower === undefined) return 0;
  const upper = sorted[base + 1];
  if (upper === undefined) return lower;
  return lower + (position - base) * (upper - lower);
}

/** 轴上限取整到 1/2/5×10ⁿ，避免刻度标出 ¥287.5 这种数。 */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function money(value: number): string {
  return Number.isInteger(value) ? `¥${value}` : `¥${value.toFixed(2)}`;
}

const AXIS_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

export function PriceStrip({
  points,
  emptyHint = '当前社区还没有已归档的计价物品',
  className,
}: {
  points: PricePoint[];
  emptyHint?: string;
  className?: string;
}) {
  const { ref, shown } = useInViewOnce<HTMLElement>();

  if (points.length === 0) {
    return (
      <p className={cn('py-8 text-center text-[12.5px] text-ink-3', className)}>{emptyHint}</p>
    );
  }

  const prices = points.map((point) => point.price).sort((a, b) => a - b);
  const domainMax = niceCeil(prices[prices.length - 1] ?? 0);
  const toPercent = (value: number): number => (value / domainMax) * 100;

  const median = quantile(prices, 0.5);
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);

  return (
    <figure ref={ref} className={cn('m-0', className)} data-shown={shown}>
      <div
        role="img"
        aria-label={`成交价分布：共 ${points.length} 件，中位数 ${money(median)}，四分位区间 ${money(q1)} 至 ${money(q3)}`}
        className="relative h-[76px] select-none"
      >
        {/* 刻度：每件物品一道 1px 竖线。延迟按横轴位置给，因此是一趟从左到右的扫过，
            而不是按数组顺序乱跳 —— 数据点的先后不该由后端返回顺序决定。 */}
        {points.map((point) => (
          <span
            key={point.id}
            title={point.label ? `${point.label} · ${money(point.price)}` : money(point.price)}
            className="draw-y absolute bottom-[26px] h-7 w-px bg-accent/85"
            style={{
              left: `${toPercent(point.price)}%`,
              transitionDelay: `${60 + toPercent(point.price) * 1.4}ms`,
            }}
          />
        ))}

        {/* 箱体：Q1–Q3 一段浅底，中位数一道实线 */}
        <span
          className="draw-x absolute bottom-[19px] h-[7px] rounded-xs bg-accent/15"
          style={{
            left: `${toPercent(q1)}%`,
            width: `${Math.max(toPercent(q3) - toPercent(q1), 0.4)}%`,
            transitionDelay: '200ms',
          }}
          aria-hidden
        />
        <span
          className="draw-y absolute bottom-[16px] h-[13px] w-[2px] rounded-full bg-ink"
          style={{ left: `${toPercent(median)}%`, transitionDelay: '240ms' }}
          aria-hidden
        />

        {/* 轴 */}
        <span className="draw-x absolute inset-x-0 bottom-[15px] h-px bg-line-strong" aria-hidden />

        {AXIS_STEPS.map((step) => (
          <span
            key={step}
            className={cn(
              'tnum absolute bottom-0 text-[10px] text-ink-3 anim-fade',
              step === 0 ? 'left-0' : step === 1 ? 'right-0' : '-translate-x-1/2',
            )}
            style={{
              ...(step === 0 || step === 1 ? null : { left: `${step * 100}%` }),
              animationDelay: `${step * 60}ms`,
            }}
            aria-hidden
          >
            {money(domainMax * step)}
          </span>
        ))}
      </div>

      <figcaption className="tnum mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-ink-3">
        <span>
          <span className="text-ink-2">{points.length}</span> 件
        </span>
        <span>
          中位 <span className="text-ink-2">{money(median)}</span>
        </span>
        <span>
          四分位 <span className="text-ink-2">{money(q1)}</span>–
          <span className="text-ink-2">{money(q3)}</span>
        </span>
      </figcaption>
    </figure>
  );
}
