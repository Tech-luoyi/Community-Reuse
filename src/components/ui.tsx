import { AlertCircle, RefreshCw } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import React, { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * 基础样式层（v3）
 * ---------------------------------------------------------------------------
 * 贯穿全站的规则，改动前先确认没有破坏它们：
 *
 * - **主按钮是近黑，不是绿色**。绿色留给"可领取 / 成功"这类语义标识。
 *   大面积绿色填充是最典型的"AI 味"来源 —— 它让每个按钮都在抢注意力。
 * - **字重只用 400 / 500 / 600**。层级由字号、颜色、留白承担。
 * - **高度有语义**。静止容器贴地（shadow-card），可点容器才抬升
 *   （shadow-card-hover）。全都浮起来 = 没有层次。
 * - **阴影是三层不是一层**。顶部内高光 + 接触影 + 扩散影，缺一层就发假。
 *   阴影色用墨色混色，继承表面色相，不把暖白画布弄脏。
 * - **不用 `transition-all`**。只声明要动的属性，避免把 width/height
 *   拉进过渡而触发重排。
 * - **字号走刻度不用任意值**。text-2xs / text-sm / text-base-app /
 *   text-lg-app / text-xl-app / text-2xl-app，每级都带好 line-height
 *   和字距。text-sm 这类写法是排版失控的起点。
 */

const buttonVariants = cva(
  // focus 环交给 globals.css 的 :focus-visible 统一处理，这里只留键盘/鼠标行为差异。
  // transition 只声明要动的属性：transform + box-shadow + color/background。
  // 绝不用 `transition-all` —— 它会在 hover 时把 width/height 也拉进过渡，
  // 触发不必要的重排。
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** 主操作。近黑实心，页面上每屏至多一个。按下时缩 0.97 并加深阴影。 */
        primary:
          'bg-ink text-ink-inverse shadow-sm transition-[transform,box-shadow,background-color] duration-200 ease-out-expo hover:bg-ink/90 hover:shadow-md active:scale-[0.97] active:shadow-xs',
        /** 次操作。白底描边 + 贴地阴影，和主按钮同处一个高度层。 */
        secondary:
          'border border-line bg-surface text-ink shadow-xs transition-[transform,box-shadow,background-color] duration-200 ease-out-expo hover:bg-surface-sunken hover:shadow-sm active:scale-[0.98]',
        /** 弱操作。无背景无阴影，悬停才出现底色。 */
        ghost:
          'text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink',
        /** 危险操作。红只在这里出现。 */
        danger:
          'bg-danger text-white shadow-sm transition-[transform,box-shadow,background-color] duration-200 ease-out-expo hover:bg-danger/90 active:scale-[0.97]',
        /** AI 相关操作。紫色描边 + 极浅底，和主流程视觉分离。 */
        ai: 'border border-ai-line bg-ai-bg text-ai transition-colors duration-150 hover:bg-ai-line/50',
        /**
         * 品牌操作。**整个系统里唯一带彩色光晕的按钮**，所以它是全站最强的
         * 视觉锚点 —— 只给「加入小区」这一个转化动作用，每屏至多出现一次。
         * 光晕是静态 box-shadow，不动 filter，避免每帧重绘。
         */
        brand:
          'bg-brand text-white shadow-[0_1px_2px_-1px_rgb(4_120_87/0.4),0_8px_24px_-8px_rgb(16_185_129/0.55)] transition-[transform,box-shadow,background-color] duration-200 ease-out-expo hover:bg-brand-deep hover:shadow-[0_2px_4px_-2px_rgb(4_120_87/0.45),0_12px_32px_-8px_rgb(16_185_129/0.6)] active:scale-[0.97]',
      },
      size: {
        sm: 'h-8 rounded-sm px-2.5 text-xs [&_svg:not([class*=size-])]:size-3.5',
        md: 'h-9 px-3.5 [&_svg:not([class*=size-])]:size-4',
        lg: 'h-11 px-5 text-base-app [&_svg:not([class*=size-])]:size-4',
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
 * v2 是"白底 + 1px 边框 + 零阴影"，理由是同屏多卡片时阴影会让页面发脏。
 * 这个顾虑是对的，但结论下反了 —— 问题不是"阴影太重"，是"只有一层阴影"。
 *
 * 现在用的是 --shadow-card：顶部 1px 内高光 + 接触影 + 扩散影，三层。
 * 高光模拟光从上方来，接触影紧贴底边，扩散影柔和外扩。这才是真实光照，
 * 也才是卡片看起来有「厚度」的原因。颜色用墨色混色（继承表面色相）而非
 * 纯黑，所以不会把暖白画布弄脏。
 *
 * 默认仍是**贴地**状态。只有明确可点的容器才加 `interactive` 抬升 ——
 * 全都浮起来等于没有层次。
 */
export function Card({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface shadow-card',
        interactive &&
          'transition-[transform,box-shadow] duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-card-hover',
        className,
      )}
      {...props}
    />
  );
}

const badgeVariants = cva(
  // h-5 + rounded-full：胶囊只留给状态与筛选，普通容器不用。
  // 字号走 text-2xs 刻度（11px + 0.01em 字距），不用 text-2xs 任意值。
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs font-medium whitespace-nowrap [&_svg]:size-3',
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

/** `Field` 认得的原生表单控件标签（直接写 `<input>` 的场景）。 */
const CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

/**
 * 判断一个 React 节点是否「就是那个要被关联的表单控件」。
 *
 * 两个来源都要认：
 *   1. **原生标签** —— `<input>` / `<select>` / `<textarea>`
 *   2. **本文件导出的控件组件** —— `<Input>` / `<Textarea>`。按引用比较，
 *      因为它们的 `type` 是函数而不是字符串。
 *
 * 只判 (1) 是不够的：调用方写的都是 `<Input/>`（组件），它的 `type` 是函数，
 * 于是 `CONTROL_TAGS.has(...)` 恒为 false，一个 id 都不会注入 —— 这正是第一版
 * Field 改完仍然在浏览器里实测到 `inputs[].id === ""` 的原因。
 * 这里与 `Input` / `Textarea` 同文件，按引用比较不会有循环依赖。
 */
function isFormControl(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false;
  const type = (node as React.ReactElement).type;
  if (typeof type === 'string') return CONTROL_TAGS.has(type);
  return type === Input || type === Textarea;
}

/**
 * 字段容器：label + 控件 + 说明/错误，页面里所有表单行都用它保证间距一致。
 *
 * **label 必须与控件程序化关联**（`htmlFor` ↔ `id`）。这不是锦上添花：
 * 之前 `<label>` 是控件的兄弟节点，既没有 `htmlFor` 也没有 `id`，于是全站
 * 每一个输入框对屏幕阅读器都是「无名称的编辑框」—— 视觉上标签就摆在正上方，
 * 但辅助技术完全读不到，二者只靠位置猜。实测（浏览器 DOM）：
 * `labels[].htmlFor === ""` 且 `inputs[].id === ""`。
 *
 * 现在用 `useId()` 生成稳定 id，注入给第一个表单控件；控件自带 `id` 时不覆盖，
 * 且 label 的 `htmlFor` 会跟着控件走。提示与错误用 `aria-describedby` 挂上去，
 * 读屏会连着念出来。
 */
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
  const autoId = useId();
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;

  /*
    给「第一个可聚焦控件」注入 id / aria-*，而不是假设 children 只有一个元素。

    这个区别不是洁癖，而是实测抓到的真 bug：`/join` 的「邀请码」字段传的是
    两个子节点 —— `<Input/>` 加上装演示码按钮的那个 `<div>`。
    之前只在 `React.isValidElement(children)` 为真时注入，而数组形式的 children
    走的是 `isValidElement === false` 分支，于是**一个属性都没注入**：
    label 照样拿到了 autoId 并写进 htmlFor，控件的 id 仍是空串。
    悬空的 htmlFor 比没有 htmlFor 更糟 —— 辅助技术会照着 id 去找、然后找不到。
    浏览器实测（修 Field 之后、发现这个问题之前）：
      labels → htmlFor: "_R_5pbn5r9lb_"     inputs → id: ""

    所以走 React.Children 的正规路径：遍历所有子节点，把 id / aria-* 注入到
    第一个原生表单控件（input / select / textarea）上。演示码那些 `<button>`
    不是表单控件，会被跳过。子节点自带 id 时以它为准（label 的 htmlFor 跟着走）。
  */
  const first = React.Children.toArray(children).find(isFormControl);
  const childId = React.isValidElement(first)
    ? ((first.props as { id?: string }).id ?? autoId)
    : autoId;

  const describedBy =
    [error ? errorId : null, !error && hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  let injected = false;
  const child = React.Children.map(children, (node) => {
    if (injected || !isFormControl(node)) return node;
    injected = true;
    return React.cloneElement(node as React.ReactElement<Record<string, unknown>>, {
      id: childId,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-required': required || undefined,
    });
  });

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={childId} className="flex items-baseline gap-1 text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {child}
      {error ? (
        <p id={errorId} className="flex items-start gap-1 text-xs text-danger">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-ink-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlClass =
  // shadow-xs 给了输入框一点"内凹"的错觉，配合 border 就有了体积。
  // 不用 inset 阴影 —— 那会让输入框看起来是洞，文本框应该是可以写字的纸面。
  'w-full rounded-md border border-line bg-surface text-sm text-ink shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-ink-tertiary focus:border-line-strong disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-tertiary disabled:shadow-none';

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
  // 用 .skeleton（微光扫过）而不是 animate-pulse（整块明暗闪）。
  // 后者读起来像「加载坏了」，前者读起来是「正在加载」。
  return <div className={cn('skeleton rounded-md', className)} />;
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
    // 空态不画实心卡片：虚线边界 + 极浅底就够了。给空态加阴影会让
    // 「这里还没有东西」看起来像「这里有一个东西，只是里面是空的」。
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong/70 bg-surface/60 px-6 py-16 text-center">
      {icon && (
        <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface-sunken text-ink-tertiary">
          {icon}
        </span>
      )}
      <p className="text-base-app font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm leading-relaxed text-ink-secondary">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * 区块标题。
 *
 * kicker 是"这一块在讲什么"的短标签，用小号字 + 弱化色 + 字距，
 * 而不是深色药丸 —— 深色块会把读者的视线从内容拉到标签上。
 * 字号全部走刻度（text-lg-app 带 -0.011em 字距），不用 tracking 任意值。
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
      <div className="space-y-1.5">
        {kicker && (
          <div className="text-2xs font-medium tracking-[0.1em] text-ink-tertiary uppercase">
            {kicker}
          </div>
        )}
        <h2 className="text-xl-app font-semibold text-ink">{title}</h2>
        {desc && <p className="max-w-xl text-sm leading-relaxed text-ink-secondary">{desc}</p>}
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
    <div className="rounded-lg border border-danger-line bg-danger-bg px-4 py-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-danger">
        <AlertCircle size={14} className="shrink-0" />
        {title}
      </div>
      <p className="mt-1 leading-relaxed text-danger/85">{hint}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
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
    <div className={cn('space-y-1', className)}>
      {/* 数字用 text-2xl-app（28px，带 -0.021em 字距）。字越大字距越紧，
          这是光学规律 —— 数字的字形本来就是方的，紧一点才不散。 */}
      <div className="text-2xl-app font-semibold text-ink tabular">{value}</div>
      <div className="text-2xs text-ink-tertiary">{label}</div>
    </div>
  );
}
