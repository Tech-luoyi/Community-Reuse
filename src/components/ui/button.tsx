import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md',
    'font-medium transition-[color,background-color,border-color,opacity] duration-[110ms] ease-out',
    'disabled:pointer-events-none disabled:opacity-45 active:translate-y-px',
    '[&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-ink text-paper hover:bg-ink/88',
        accent: 'bg-accent text-white hover:bg-accent-hover',
        secondary:
          'border border-line bg-surface text-ink hover:border-line-strong hover:bg-sunken',
        ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
        danger: 'border border-transparent bg-danger-soft text-danger hover:border-danger/25',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12.5px] [&_svg]:size-3.5',
        md: 'h-9 px-3.5 text-[13px] [&_svg]:size-4',
        lg: 'h-10 px-4 text-sm [&_svg]:size-4',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} type={type} {...props} />
  );
}

/** 行内文字动作：比 ghost 更轻，用于表格行尾。 */
export function TextAction({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-xs px-1 py-0.5 text-[12.5px] font-medium text-ink-2 underline-offset-4',
        'transition-colors duration-[110ms] ease-out hover:text-accent hover:underline',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { buttonVariants };
