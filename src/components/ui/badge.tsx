import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-[11px] font-medium leading-[1.45] whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-ink-2 ring-1 ring-line ring-inset',
        accent: 'bg-accent-soft text-accent-ink',
        info: 'bg-info-soft text-info',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        solid: 'bg-ink text-paper',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** 状态点 + 文案：状态机语义用，颜色只由 tone 决定，一个 chip 只允许一个色相。 */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: NonNullable<VariantProps<typeof badgeVariants>['tone']>;
  children: React.ReactNode;
  className?: string;
}) {
  const dotTone = {
    neutral: 'bg-ink-3',
    accent: 'bg-accent',
    info: 'bg-info',
    warning: 'bg-warning',
    danger: 'bg-danger',
    solid: 'bg-paper',
  }[tone];

  return (
    <Badge tone={tone} className={className}>
      <span className={cn('size-1.5 shrink-0 rounded-full', dotTone)} aria-hidden />
      {children}
    </Badge>
  );
}

export { badgeVariants };
