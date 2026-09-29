import { cn } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import React from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50 active:scale-[.97] cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-stone-900 text-white shadow-[0_8px_24px_rgba(28,25,23,.25)] hover:bg-emerald-600 hover:shadow-[0_8px_28px_rgba(22,163,74,.45)] hover:-translate-y-px',
        accent:
          'bg-gradient-to-r from-emerald-500 to-lime-500 text-white shadow-[0_8px_24px_rgba(22,163,74,.4)] hover:brightness-110 hover:-translate-y-px',
        warm: 'bg-gradient-to-r from-orange-500 to-amber-400 text-white shadow-[0_8px_24px_rgba(249,115,22,.4)] hover:brightness-110 hover:-translate-y-px',
        outline:
          'border border-stone-200 bg-white hover:border-emerald-400 hover:text-emerald-700 hover:-translate-y-px',
        ghost: 'hover:bg-stone-100 text-stone-600 hover:text-stone-900',
        danger: 'bg-red-500 text-white shadow hover:bg-red-600',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-xl',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base rounded-2xl',
        icon: 'h-10 w-10 rounded-2xl',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/**
 * 全站基础容器。原先是 `bg-white/85 backdrop-blur-xl`：
 * 一个页面里往往有 4~6 个 Card 同时存在，每个都是一层实时模糊。
 * 改成不透明白底 + 轻投影，观感一致但不再逐帧重算。
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-stone-200/70 bg-white shadow-[0_1px_3px_rgba(28,25,23,.06)]',
        className,
      )}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide',
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm outline-none transition-all placeholder:text-stone-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition-all placeholder:text-stone-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 min-h-[96px] resize-y',
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-2xl bg-gradient-to-r from-stone-100 via-stone-200 to-stone-100 bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

export function EmptyState({
  emoji,
  title,
  hint,
  action,
}: {
  emoji: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-stone-300 bg-white/60 px-6 py-14 text-center">
      <div className="text-5xl">{emoji}</div>
      <div className="text-base font-bold">{title}</div>
      {hint && <div className="max-w-sm text-sm text-stone-500">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function SectionTitle({
  kicker,
  title,
  desc,
}: {
  kicker: string;
  title: React.ReactNode;
  desc?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-lime-300">
        <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
        {kicker}
      </div>
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h2>
      {desc && <p className="max-w-xl text-sm leading-relaxed text-stone-500">{desc}</p>}
    </div>
  );
}

/**
 * 「请求失败」态：接口已就位却读不到时用它，而不是 `EmptyState`。
 *
 * 分工是刻意的 —— 空态断言「这里没有数据」，本组件只陈述「这次没读到」。
 * 用 `.catch(() => [])` 把失败下沉成空态，会让用户读到假事实
 * （例：收藏夹明明有东西，却显示「还空着」）。
 */
export function ErrorPanel({
  title,
  hint,
  onRetry,
  fetching,
}: {
  title: string;
  hint: string;
  onRetry?: () => void;
  fetching?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/60 p-4 text-sm">
      <div className="font-black text-rose-700">{title}</div>
      <p className="mt-1 leading-relaxed text-rose-600/90">{hint}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          <RefreshCw size={13} className={fetching ? 'animate-spin' : undefined} /> 重试
        </Button>
      )}
    </div>
  );
}
