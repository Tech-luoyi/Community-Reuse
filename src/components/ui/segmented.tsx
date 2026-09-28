import * as React from 'react';

import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 分段控件：筛选器的主要形态。
 * 用 `role="radiogroup"` 而不是 Tab，因为它改变的是同一份数据的视图参数，语义是单选。
 * 选中态是一片滑动的白底（thumb），而不是逐格切换背景——切换的方向因此可被看见。
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const itemSize = size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]';
  const containerRef = React.useRef<HTMLDivElement>(null);
  const buttons = React.useRef(new Map<T, HTMLButtonElement>());
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  const activeValue = options.some((option) => option.value === value) ? value : options[0]?.value;

  // 首次测量放在 layout effect 里，浏览器还没绘制，thumb 不会出现"从 0 滑过来"的开场。
  // ResizeObserver 负责容器尺寸变化（字体加载、label 变长）后的重新对齐。
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const el = activeValue === undefined ? undefined : buttons.current.get(activeValue);
      if (!el) return;
      setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeValue, options]);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0.5 left-0 rounded-xs bg-surface shadow-card',
          'ease-out transition-[width,transform] duration-[260ms]',
          thumb ? '' : 'opacity-0 transition-none',
        )}
        style={{ width: thumb?.width ?? 0, transform: `translateX(${thumb?.left ?? 0}px)` }}
      />
      {options.map((option) => {
        const active = option.value === activeValue;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttons.current.set(option.value, node);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-1 rounded-xs font-medium whitespace-nowrap ease-out transition-colors duration-[170ms]',
              itemSize,
              active ? 'text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
