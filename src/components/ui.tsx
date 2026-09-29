import { AlertCircle, RefreshCw } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import React from 'react';
import { cn } from '@/lib/utils';

/**
 * 基础样式层（v2）
 * ---------------------------------------------------------------------------
 * 几条贯穿全站的规则，改动前先确认没有破坏它们：
 *
 * - **主按钮是近黑，不是绿色**。绿色留给"可领取 / 成功"这类语义标识。
 *   大面积绿色填充是最典型的"AI 味"来源 —— 它让每个按钮都在抢注意力。
 * - **字重只有 400 / 500 / 600**。层级由字号、颜色、留白承担。
 * - **默认无阴影**，靠 1px 边框和留白分层。阴影只留给浮层（Sheet / Dialog）。
 * - **无渐变**。渐变按钮和渐变边框是同一类问题：装饰压过信息。
 */

const buttonVariants = cva(
  // focus 环交给 globals.css 的 :focus-visible 统一处理，这里只留键盘/鼠标行为差异
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** 主操作。近黑实心，页面上每屏至多一个。 */
        primary: 'bg-ink text-white hover:bg-ink/88 active:bg-ink',
        /** 次操作。白底描边。 */
        secondary: 'border border-line bg-surface text-ink hover:bg-surface-sunken',
        /** 弱操作。无背景，悬停才出现底色。 */
        ghost: 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
        /** 危险操作。红只在这里出现。 */
        danger: 'bg-danger text-white hover:bg-danger/90',
        /** AI 相关操作。紫色描边 + 极浅底，和主流程视觉分离。 */
        ai: 'border border-ai-line bg-ai-bg text-ai hover:bg-ai-bg/70',
      },
      size: {
        sm: 'h-8 rounded-sm px-2.5 text-xs [&_svg:not([class*=size-])]:size-3.5',
        md: 'h-9 px-3.5 [&_svg:not([class*=size-])]:size-4',
        lg: 'h-11 px-5 [&_svg:not([class*=size-])]:size-4',
        icon: 'size-9 [&_svg:not([class*=size-])]:size-4',
        'icon-sm': 'size-8 rounded-sm [&_svg:not([class*=size-])]:size-4',
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
 * 基础容器。
 *
 * 刻意保持"白底 + 1px 边框 + 零阴影"：一层背景色差就能把卡片从画布上分开，
 * 阴影会让同屏多卡片时页面发灰发脏。需要强调的容器用 `ring-1` 或换底色，
 * 不要加阴影。
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)} {...props} />;
}

const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      /**
       * tone 与 globals.css 的语义色一一对应。
       * 状态色只在这里出现 —— 页面里不要再手写 `bg-amber-100 text-amber-800`，
       * 那正是上一版状态色到处不一致的来源。
       */
      tone: {
        available: 'border-available-line bg-available-bg text-available',
        reserved: 'border-reserved-line bg-reserved-bg text-reserved',
        info: 'border-info-line bg-info-bg text-info',
        pending: 'border-pending-line bg-pending-bg text-pending',
        danger: 'border-danger-line bg-danger-bg text-danger',
        done: 'border-line bg-surface-sunken text-ink-secondary',
        archived: 'border-line bg-surface-sunken text-archived',
        ai: 'border-ai-line bg-ai-bg text-ai',
        neutral: 'border-line bg-transparent text-ink-secondary',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** 状态色调名。业务代码用它把领域状态映射到统一色板。 */
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** 字段容器：label + 控件 + 说明/错误，页面里所有表单行都用它保证间距一致。 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="flex items-baseline gap-1 text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-xs text-danger">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

const controlClass =
  'w-full rounded-md border border-line bg-surface text-sm text-ink transition-colors placeholder:text-ink-tertiary disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-tertiary';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, 'h-9 px-3', className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(controlClass, 'min-h-24 resize-y px-3 py-2', className)} {...props} />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-sunken', className)} />;
}

/**
 * 空态。
 *
 * `icon` 传 ReactNode（lucide 图标），不再收 emoji 字符串 ——
 * emoji 在同一屏里大小、光泽、基线都不可控，是"模板感"的主要来源。
 * 不传图标时只留文字，避免为填空而堆装饰。
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-14 text-center">
      {icon && (
        <span className="mb-1 grid size-10 place-items-center rounded-full bg-surface-sunken text-ink-tertiary">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] leading-relaxed text-ink-secondary">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * 区块标题。
 *
 * kicker 是"这一块在讲什么"的短标签，用小号字 + 弱化色 + 字距，
 * 而不是深色药丸 —— 深色块会把读者的视线从内容拉到标签上。
 */
export function SectionTitle({
  kicker,
  title,
  desc,
  action,
}: {
  kicker?: string;
  title: React.ReactNode;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        {kicker && (
          <div className="text-[11px] font-medium tracking-[0.08em] text-ink-tertiary uppercase">
            {kicker}
          </div>
        )}
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {desc && <p className="max-w-xl text-[13px] leading-relaxed text-ink-secondary">{desc}</p>}
      </div>
      {action}
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
    <div className="rounded-lg border border-danger-line bg-danger-bg px-4 py-3 text-[13px]">
      <div className="flex items-center gap-1.5 font-medium text-danger">
        <AlertCircle size={14} className="shrink-0" />
        {title}
      </div>
      <p className="mt-1 leading-relaxed text-danger/85">{hint}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-2.5" onClick={onRetry}>
          <RefreshCw size={13} className={fetching ? 'animate-spin' : undefined} /> 重试
        </Button>
      )}
    </div>
  );
}

/** 分隔线。默认很淡，只有确实需要断开视觉时才用。 */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-line', className)} />;
}

/** 一组"标签 — 数值"的紧凑指标。替代上一版带 emoji 的深色小卡。 */
export function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <div className="text-xl font-semibold tracking-[-0.01em] text-ink tabular">{value}</div>
      <div className="text-xs text-ink-tertiary">{label}</div>
    </div>
  );
}
