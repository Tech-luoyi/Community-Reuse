import { Search, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-md border border-line bg-surface px-3 text-[13px] text-ink ' +
  'placeholder:text-ink-3 transition-colors duration-[110ms] ease-out ' +
  'focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/12 ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3';

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'h-9',
        invalid && 'border-danger focus:border-danger focus:ring-danger/12',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'min-h-[92px] resize-y py-2.5 leading-relaxed',
        invalid && 'border-danger focus:border-danger focus:ring-danger/12',
        className,
      )}
      {...props}
    />
  );
}

/** 表单字段外壳：标签 + 计数/提示 + 错误。错误文案直接取 Zod / 服务端 details。 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  counter,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  counter?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {counter && <span className="tnum text-[11px] text-ink-3">{counter}</span>}
      </div>
      {children}
      {error ? (
        <p className="text-[12px] font-medium text-danger">{error}</p>
      ) : (
        hint && <p className="text-[12px] leading-relaxed text-ink-3">{hint}</p>
      )}
    </div>
  );
}

export function SearchInput({
  value,
  onValueChange,
  placeholder = '搜索',
  className,
  inputRef,
}: {
  value: string;
  onValueChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={15}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          fieldBase,
          'h-9 pr-8 pl-8',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onValueChange('')}
          aria-label="清除搜索"
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-xs text-ink-3 transition-colors duration-[110ms] hover:bg-sunken hover:text-ink"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
