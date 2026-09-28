import * as React from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * 图标按钮。`label` 是必填而非可选：没有可见文字的按钮必须有可访问名，
 * 类型层面钉死比 code review 靠谱。
 */
export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  variant?: 'secondary' | 'ghost' | 'primary' | 'accent' | 'danger';
  size?: 'icon' | 'icon-sm';
}

export function IconButton({
  label,
  icon: Icon,
  variant = 'ghost',
  size = 'icon',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      <Icon aria-hidden />
    </button>
  );
}
