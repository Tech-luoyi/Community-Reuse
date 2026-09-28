'use client';

import {
  Archive,
  Check,
  Heart,
  Inbox,
  Image as ImageIcon,
  MessageSquare,
  Package,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import * as React from 'react';

import { BarSeries } from '@/components/features/bar-series';
import { ClaimRow } from '@/components/features/claim-row';
import { FreshnessRibbon } from '@/components/features/freshness-ribbon';
import { ItemRow } from '@/components/features/item-row';
import { PriceStrip } from '@/components/features/price-strip';
import { StatTile } from '@/components/features/stat-tile';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button, TextAction, buttonVariants } from '@/components/ui/button';
import { ContractGap } from '@/components/ui/contract-gap';
import { CoverPlate } from '@/components/ui/cover-plate';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input, SearchInput, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Inset, MetaList, Panel, PanelHeader } from '@/components/ui/panel';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { RowSkeleton, Skeleton } from '@/components/ui/skeleton';
import { Stagger } from '@/components/ui/stagger';
import { cn } from '@/lib/cn';
import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_TONE,
  FRESHNESS_TONE,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_TONE,
  TRADE_TYPE_LABEL,
} from '@/lib/format';
import { SAMPLE_CLAIMS, SAMPLE_ITEM_BY_ID, SAMPLE_ITEMS } from './fixtures';
import type { ClaimStatus, FreshnessCode, ItemStatus, TradeType } from '@/shared/types';

/* ---------------------------------------------------------------- 区块骨架 */

const SECTIONS = [
  { id: 'type', label: '排版尺度' },
  { id: 'color', label: '色彩令牌' },
  { id: 'button', label: '按钮' },
  { id: 'form', label: '表单' },
  { id: 'badge', label: '徽标与状态' },
  { id: 'panel', label: '面板' },
  { id: 'cover', label: '封面盘' },
  { id: 'rows', label: '数据行' },
  { id: 'chart', label: '图表' },
  { id: 'gap', label: '契约缺口' },
  { id: 'empty', label: '空态与骨架' },
  { id: 'motion', label: '动效' },
  { id: 'avoid', label: '刻意回避' },
] as const;

function Section({
  id,
  index,
  title,
  desc,
  children,
}: {
  id: string;
  index: number;
  title: string;
  desc?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line py-9 first:border-t-0 first:pt-0">
      <div className="mb-6">
        <div className="label-xs font-mono">
          {String(index).padStart(2, '0')} · {id.toUpperCase()}
        </div>
        <h2 className="mt-2 text-[19px] leading-tight font-semibold tracking-[-0.015em] text-ink">
          {title}
        </h2>
        {desc && <p className="mt-2 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

/** 演示用的小标题，比 Section 低一级。 */
function Sub({ children }: { children: React.ReactNode }) {
  return <div className="label-xs mb-2.5">{children}</div>;
}

/* ------------------------------------------------------------------ 排版 */

const TYPE_SCALE = [
  {
    spec: '11 / 550 / +0.06em',
    usage: '眉标，全大写 + 等宽',
    sample: 'SECTION EYEBROW',
    className: 'label-xs font-mono',
  },
  {
    spec: '11.5 / 400 / tnum',
    usage: '时间线与辅助元信息',
    sample: '09-29 01:48 · 3栋-老王 · 4h',
    className: 'tnum text-[11.5px] text-ink-3',
  },
  {
    spec: '12.5 / 400 / 1.62',
    usage: '次级正文、说明、提示',
    sample: '物品描述与提示文案使用这一级，行高放宽到 1.62 以便中文长句呼吸。',
    className: 'text-[12.5px] leading-[1.62] text-ink-2',
  },
  {
    spec: '13 / 400',
    usage: '基准正文（body）',
    sample: '邻里之间把闲下来的东西交给用得上的人。',
    className: 'text-[13px] text-ink',
  },
  {
    spec: '14.5 / 600 / -0.008em',
    usage: '行内主标题（申请）',
    sample: '大学教材若干（计算机类）',
    className: 'text-[14.5px] font-semibold tracking-[-0.008em] text-ink',
  },
  {
    spec: '16 / 600 / -0.011em',
    usage: '列表行标题（物品）',
    sample: '闲置婴儿推车',
    className: 'text-[16px] font-semibold tracking-[-0.011em] text-ink',
  },
  {
    spec: '19 / 600 / -0.015em',
    usage: '区块标题',
    sample: '契约缺口',
    className: 'text-[19px] font-semibold tracking-[-0.015em] text-ink',
  },
  {
    spec: '26 / 600 / -0.021em',
    usage: '页标题',
    sample: '物品集市',
    className: 'text-[26px] font-semibold tracking-[-0.021em] text-ink',
  },
  {
    spec: '30 / 600 / tnum',
    usage: '看板主数字',
    sample: '128',
    className: 'tnum text-[30px] leading-none font-semibold tracking-[-0.024em] text-ink',
  },
] as const;

function TypeSection({ index }: { index: number }) {
  return (
    <Section
      id="type"
      index={index}
      title="排版尺度"
      desc={
        <>
          纸墨 + 发丝线 + 无阴影的方案，质感只能靠
          <strong className="font-semibold text-ink">真实的字号字重对比</strong>
          撑住。已知失败模式是整页统一 14px 灰字 —— 那会读成「没画完的线框图」，而不是高级感。
          所以下面这九级必须同时存在，且跨度要够大：11px 全大写眉标与 30px 主数字之间是 2.7 倍差。
        </>
      }
    >
      <Panel className="divide-y divide-line">
        {TYPE_SCALE.map((row) => (
          <div
            key={row.spec}
            className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-5 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline"
          >
            <div className="min-w-0">
              <div className="tnum text-[11.5px] font-medium text-ink-2">{row.spec}</div>
              <div className="mt-0.5 text-[11.5px] text-ink-3">{row.usage}</div>
            </div>
            <div className={cn('min-w-0', row.className)}>{row.sample}</div>
          </div>
        ))}
      </Panel>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="p-5">
          <Sub>八分栅格与间距节奏</Sub>
          <div className="flex items-end gap-1">
            {[4, 8, 12, 16, 24, 32, 48].map((step) => (
              <div key={step} className="flex flex-col items-center gap-1.5">
                <div className="w-6 bg-accent/85" style={{ height: step }} />
                <span className="tnum text-[10px] text-ink-3">{step}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            所有间距取 4 的倍数。行内元素用 8pt，区块之间用 24/32，页面外边距 28/32。
          </p>
        </Panel>

        <Panel className="p-5">
          <Sub>等宽与表格数字</Sub>
          <div className="space-y-2 rounded-md border border-line bg-sunken p-3">
            <div className="tnum text-[13px] text-ink">¥1,280.00 · 09-29 01:48 · 42 件</div>
            <div className="tnum text-[13px] text-ink">
              ¥&nbsp;&nbsp;&nbsp;45.50 · 08-19 08:00 · 7 件
            </div>
            <div className="text-[11.5px] text-ink-3">
              同上两行未使用 <span className="tnum">.tnum</span> 时的对照：
            </div>
            <div className="text-[13px] text-ink-2">¥1,280.00 · 09-29 01:48 · 42 件</div>
            <div className="text-[13px] text-ink-2">¥45.50 · 08-19 08:00 · 7 件</div>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            金额、时间、计数、ID 一律走 <span className="tnum">.tnum</span>
            （等宽 + tabular-nums），这样列内数字右端对齐，数值变化时也不会横向抖动。
          </p>
        </Panel>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 色彩 */

const TOKEN_GROUPS = [
  {
    eyebrow: '纸面',
    tokens: [
      { name: '--paper', usage: '页面底色' },
      { name: '--surface', usage: '面板 / 卡片' },
      { name: '--surface-sunken', usage: '下沉表面、代码块' },
    ],
  },
  {
    eyebrow: '墨色',
    tokens: [
      { name: '--ink', usage: '主文本、主按钮底' },
      { name: '--ink-secondary', usage: '次级文本' },
      { name: '--ink-tertiary', usage: '元信息、眉标' },
    ],
  },
  {
    eyebrow: '发丝线',
    tokens: [
      { name: '--line', usage: '默认边框，替代阴影' },
      { name: '--line-strong', usage: '坐标轴、强调分隔' },
    ],
  },
  {
    eyebrow: '点缀（唯一强调色）',
    tokens: [
      { name: '--accent', usage: '深松绿，选中态与图表' },
      { name: '--accent-hover', usage: '悬浮加深' },
      { name: '--accent-soft', usage: '浅底徽标' },
      { name: '--accent-ink', usage: '浅底上的文字' },
    ],
  },
  {
    eyebrow: '语义（仅状态使用）',
    tokens: [
      { name: '--warning', usage: '已预约 / 规则兜底' },
      { name: '--danger', usage: '未通过 / 破坏性动作' },
      { name: '--info', usage: '待处理 / 较新' },
    ],
  },
] as const;

const TOKEN_NAMES = TOKEN_GROUPS.flatMap((group) => group.tokens.map((token) => token.name));

function ColorSection({ index }: { index: number }) {
  // 从计算样式里读真实值，保证这份文档不可能和 globals.css 漂移
  const [resolved, setResolved] = React.useState<ReadonlyMap<string, string>>(new Map());

  React.useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const next = new Map<string, string>();
    for (const name of TOKEN_NAMES) {
      const value = style.getPropertyValue(name).trim();
      if (value.length > 0) next.set(name, value);
    }
    setResolved(next);
  }, []);

  return (
    <Section
      id="color"
      index={index}
      title="色彩令牌"
      desc={
        <>
          中性纸墨打底，全站只有一个强调色（深松绿 <span className="tnum">#2b5d4b</span>），
          语义色只允许出现在状态徽标上。
          <strong className="font-semibold text-ink">每个面板里只允许一个元素使用 accent</strong> ——
          侧栏是选中项的 2px 左规则线，列表行是「刚刚上架」徽标，图表是数据条本身。
          下面每个色块的颜色都直接取自 CSS 变量，不是文档里手抄的。
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {TOKEN_GROUPS.map((group) => (
          <Panel key={group.eyebrow} className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5">
              <div className="label-xs">{group.eyebrow}</div>
            </div>
            <div className="divide-y divide-line">
              {group.tokens.map((token) => (
                <div key={token.name} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className="size-9 shrink-0 rounded-sm ring-1 ring-line ring-inset"
                    style={{ backgroundColor: `var(${token.name})` }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="tnum truncate text-[12px] font-medium text-ink">
                      {token.name}
                    </div>
                    <div className="truncate text-[11.5px] text-ink-3">{token.usage}</div>
                  </div>
                  <div className="tnum shrink-0 text-[11px] text-ink-3 uppercase">
                    {resolved.get(token.name) ?? '—'}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <Inset className="mt-5">
        <Sub>克制检查</Sub>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[12px] font-medium text-danger">跑调：一屏多个强调色</div>
            <div className="mt-2 flex gap-1.5">
              <span className="h-6 flex-1 rounded-sm bg-accent" />
              <span className="h-6 flex-1 rounded-sm bg-info" />
              <span className="h-6 flex-1 rounded-sm bg-warning" />
              <span className="h-6 flex-1 rounded-sm bg-danger" />
            </div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-ink">采用：中性为主，一处 accent</div>
            <div className="mt-2 flex gap-1.5">
              <span className="h-6 flex-1 rounded-sm bg-sunken ring-1 ring-line ring-inset" />
              <span className="h-6 flex-1 rounded-sm bg-sunken ring-1 ring-line ring-inset" />
              <span className="h-6 flex-1 rounded-sm bg-sunken ring-1 ring-line ring-inset" />
              <span className="h-6 flex-1 rounded-sm bg-accent" />
            </div>
          </div>
        </div>
      </Inset>
    </Section>
  );
}

/* ------------------------------------------------------------------ 按钮 */

const BUTTON_VARIANTS = ['primary', 'accent', 'secondary', 'ghost', 'danger'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;

function ButtonSection({ index }: { index: number }) {
  const [busy, setBusy] = React.useState(false);

  return (
    <Section
      id="button"
      index={index}
      title="按钮"
      desc={
        <>
          高度 28 / 36 / 40，圆角 7px，<span className="tnum">13px</span> 中等字重。
          <code className="tnum rounded-xs bg-sunken px-1 py-0.5 text-[11.5px]">accent</code>{' '}
          变体全站只给「每页一个主动作」，其余走{' '}
          <code className="tnum rounded-xs bg-sunken px-1 py-0.5 text-[11.5px]">secondary</code>。
          进行中状态<strong className="font-semibold text-ink">用文案切换而不是转圈图标</strong>
          —— 绝大多数变更请求在 300ms 内返回，一个旋转的圆圈只会让人怀疑卡住了。
        </>
      }
    >
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className="label-xs w-[7rem] px-5 py-2.5 text-left">变体</th>
              {BUTTON_SIZES.map((size) => (
                <th key={size} className="label-xs px-5 py-2.5 text-left">
                  {size}
                </th>
              ))}
              <th className="label-xs px-5 py-2.5 text-left">disabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {BUTTON_VARIANTS.map((variant) => (
              <tr key={variant}>
                <th scope="row" className="px-5 py-3.5 text-left align-middle">
                  <span className="tnum text-[11.5px] font-medium text-ink-2">{variant}</span>
                </th>
                {BUTTON_SIZES.map((size) => (
                  <td key={size} className="px-5 py-3.5 align-middle">
                    <Button variant={variant} size={size}>
                      {variant === 'danger' ? '归档' : '领取'}
                    </Button>
                  </td>
                ))}
                <td className="px-5 py-3.5 align-middle">
                  <Button variant={variant} size="md" disabled>
                    {variant === 'danger' ? '归档' : '领取'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel className="p-5">
          <Sub>图标按钮</Sub>
          <div className="flex items-center gap-2">
            <IconButton label="搜索" icon={Search} variant="secondary" />
            <IconButton label="编辑" icon={Pencil} />
            <IconButton label="归档" icon={Archive} size="icon-sm" />
            <IconButton label="收藏" icon={Heart} variant="secondary" size="icon-sm" />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            <span className="tnum">label</span>{' '}
            是必填属性，类型层面保证不会出现没有可访问名的图标按钮。
          </p>
        </Panel>

        <Panel className="p-5">
          <Sub>进行中状态</Sub>
          <Button
            variant="accent"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              window.setTimeout(() => setBusy(false), 1600);
            }}
          >
            {busy ? '提交中…' : '提交申请'}
          </Button>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            点一下看效果。按钮同时 <span className="tnum">disabled</span>， React 19 StrictMode
            双触发也不会重复提交。
          </p>
        </Panel>

        <Panel className="p-5">
          <Sub>行内文字动作</Sub>
          <div className="flex items-center gap-3">
            <TextAction>查看详情</TextAction>
            <TextAction>撤回</TextAction>
            <TextAction disabled>已完成</TextAction>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            比 ghost 更轻一级，用在表格行尾，不和主操作抢注意力。
          </p>
        </Panel>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 表单 */

const TRADE_OPTIONS = (Object.keys(TRADE_TYPE_LABEL) as TradeType[]).map((value) => ({
  value,
  label: TRADE_TYPE_LABEL[value],
}));

function FormSection({ index }: { index: number }) {
  const [keyword, setKeyword] = React.useState('台灯');
  const [tradeType, setTradeType] = React.useState<TradeType>('FIXED_PRICE');
  const [description, setDescription] = React.useState('');

  return (
    <Section
      id="form"
      index={index}
      title="表单"
      desc="控件高度 36px，圆角 7px，聚焦时边框转 accent 并给出 3px 的 12% 光环。错误文案直接取 Zod 或服务端 details，前端不自己另编一套。"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="space-y-5 p-5">
          <Field
            label="物品名称"
            htmlFor="s-name"
            required
            counter="6 / 80"
            hint="邻居靠这个名字判断要不要点进来"
          >
            <Input id="s-name" defaultValue="闲置婴儿推车" maxLength={80} />
          </Field>

          <Field label="品类" htmlFor="s-category" hint="选填，同品类在集市里会用同一色封面盘">
            <Input id="s-category" defaultValue="母婴用品" />
          </Field>

          <Field
            label="联系方式"
            htmlFor="s-contact"
            error="联系方式不能超过 120 个字符"
            counter="128 / 120"
          >
            <Input id="s-contact" invalid defaultValue="微信 wang_1972，工作日晚上八点以后方便" />
          </Field>

          <Field
            label="描述"
            htmlFor="s-desc"
            counter={`${description.length} / 2000`}
            hint="成色、使用时长、自提地点都可以写在这里"
          >
            <Textarea
              id="s-desc"
              value={description}
              placeholder="八成新，轮子刚换过……"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </Panel>

        <div className="space-y-5">
          <Panel className="space-y-5 p-5">
            <Field label="搜索" htmlFor="s-search" hint="带清除按钮，输入为空时按钮不渲染">
              <SearchInput value={keyword} onValueChange={setKeyword} placeholder="搜索物品名称" />
            </Field>

            <div>
              <Sub>分段控件（单选语义，用 radiogroup 而不是 tab）</Sub>
              <Segmented
                ariaLabel="交易方式"
                value={tradeType}
                onChange={setTradeType}
                options={TRADE_OPTIONS}
              />
              <p className="mt-2.5 text-[12px] text-ink-3">
                当前值 <span className="tnum text-ink-2">{tradeType}</span>
              </p>
            </div>

            <div>
              <Sub>小尺寸分段</Sub>
              <Segmented
                ariaLabel="排序"
                size="sm"
                value="latest"
                onChange={() => undefined}
                options={[
                  { value: 'latest', label: '最新' },
                  { value: 'oldest', label: '最早' },
                ]}
              />
            </div>
          </Panel>

          <Panel className="p-5">
            <Sub>禁用与只读</Sub>
            <div className="space-y-3">
              <Input disabled defaultValue="已归档物品不可编辑" />
              <Input readOnly defaultValue="cl_9f2a71c0" className="tnum" />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              状态不是 ACTIVE 的物品，编辑页整表只读并说明原因，而不是给一堆灰掉的控件让人猜。
            </p>
          </Panel>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ 徽标与状态 */

const BADGE_TONES = ['neutral', 'accent', 'info', 'warning', 'danger', 'solid'] as const;

function BadgeSection({ index }: { index: number }) {
  return (
    <Section
      id="badge"
      index={index}
      title="徽标与状态"
      desc="颜色只由语义决定，一个徽标只允许一个色相。状态点 + 文案的 StatusChip 用于状态机，纯 Badge 用于分类与计数。"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="p-5">
          <Sub>Badge · 六种色调</Sub>
          <div className="flex flex-wrap items-center gap-2">
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                <span className="tnum">{tone}</span>
              </Badge>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <Sub>StatusChip · 带状态点</Sub>
          <div className="flex flex-wrap items-center gap-2">
            {BADGE_TONES.map((tone) => (
              <StatusChip key={tone} tone={tone}>
                <span className="tnum">{tone}</span>
              </StatusChip>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <Sub>物品状态</Sub>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(ITEM_STATUS_LABEL) as ItemStatus[]).map((status) => (
              <StatusChip key={status} tone={ITEM_STATUS_TONE[status]}>
                {ITEM_STATUS_LABEL[status]}
              </StatusChip>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            列表里 <span className="tnum">ACTIVE</span> 不渲染徽标 ——
            它是默认筛选值，每行都点一个等于没有重点。
          </p>
        </Panel>

        <Panel className="p-5">
          <Sub>申请状态（状态机全集）</Sub>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CLAIM_STATUS_LABEL) as ClaimStatus[]).map((status) => (
              <StatusChip key={status} tone={CLAIM_STATUS_TONE[status]}>
                {CLAIM_STATUS_LABEL[status]}
              </StatusChip>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            已完成用实心墨色收尾，和进行中的状态在视觉重量上拉开。
          </p>
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <Sub>新鲜度（label 与 code 均来自服务端，前端不重算时间差）</Sub>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['JUST_LISTED', '刚刚上架'],
                ['NEW', '较新'],
                ['OLDER', '较早'],
              ] as [FreshnessCode, string][]
            ).map(([code, label]) => (
              <Badge key={code} tone={FRESHNESS_TONE[code]}>
                {label}
                <span className="tnum opacity-60">{code}</span>
              </Badge>
            ))}
          </div>
        </Panel>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 面板 */

function PanelSection({ index }: { index: number }) {
  return (
    <Section
      id="panel"
      index={index}
      title="面板"
      desc={
        <>
          全站不用卡片阴影，只用 1px 发丝线 + 小圆角围合空间。
          <span className="tnum">PanelHeader</span> 的「等宽眉标 → 17px 标题 → 12.5px 说明 →
          右侧动作」 是整站排版节奏的来源，所有区块共用这一套。
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="COMMUNITY SNAPSHOT"
            title="临风小区"
            desc="社区快照复用列表页同一份缓存查询，不额外发请求。"
            action={<Button size="sm">切换</Button>}
          />
          <div className="px-5 py-4">
            <MetaList
              rows={[
                { label: '在架物品', value: <span className="tnum">4</span> },
                { label: '本月发布', value: <span className="tnum">12</span> },
                { label: '已归档', value: <span className="tnum">2</span> },
                { label: '邀请码', value: <span className="tnum">LINFENG-2026</span> },
              ]}
            />
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader eyebrow="NO ACTION SLOT" title="只有眉标与标题" />
            <div className="px-5 py-4 text-[12.5px] leading-relaxed text-ink-2">
              右侧动作槽是可选的。没有动作时不留空位，标题区自然收窄。
            </div>
          </Panel>

          <Inset>
            <Sub>下沉信息块 Inset</Sub>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              用于说明性文字、契约缺口、元信息表。底色比面板低一级，
              靠明度差而不是边框粗细来区分层级。
            </p>
          </Inset>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- 封面盘 */

function CoverSection({ index }: { index: number }) {
  return (
    <Section
      id="cover"
      index={index}
      title="封面盘"
      desc={
        <>
          <strong className="font-semibold text-ink">这是全站主视觉，不是异常兜底。</strong>
          <span className="tnum">public/uploads/</span> 是空目录，种子里的 6 张封面全部 404，
          其中一件物品本身就没有图。所以策略是「排版盘常驻，真实图片加载成功后才盖上来」——
          任何情况下都不会露出浏览器的破图图标。着色按品类哈希，同品类同色，
          颜色因此携带信息而不是装饰。
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel className="p-5">
          <Sub>三种尺寸</Sub>
          <div className="flex flex-wrap items-end gap-5">
            <div className="space-y-2">
              <CoverPlate
                src="/uploads/seed-404.svg"
                name="闲置婴儿推车"
                category="母婴用品"
                size="sm"
              />
              <div className="tnum text-[10.5px] text-ink-3">sm · 64</div>
            </div>
            <div className="space-y-2">
              <div className="size-[104px]">
                <CoverPlate name="小米空气净化器 2S" category="家电" size="md" />
              </div>
              <div className="tnum text-[10.5px] text-ink-3">md · 104</div>
            </div>
            <div className="space-y-2">
              <div className="h-[132px] w-[196px]">
                <CoverPlate name="大学教材若干" category="图书" size="lg" />
              </div>
              <div className="tnum text-[10.5px] text-ink-3">lg · 详情画廊</div>
            </div>
          </div>

          <Sub>按品类着色（同色 = 同品类）</Sub>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_ITEMS.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <CoverPlate
                  src={item.coverUrl}
                  name={item.name}
                  category={item.category}
                  size="sm"
                  className="size-10 rounded-sm"
                />
                <span className="text-[11.5px] text-ink-3">{item.category ?? '未分类'}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-5">
          <ContractGap
            section="§3"
            endpoint="POST /api/uploads"
            existsInstead="发布页的图片区因此是一张契约缺口卡片，而不是一个禁用的拖拽框。物品的名称、品类、描述、交易方式与价格全部可用，发布流程完整。"
          />
          <Inset>
            <Sub>为什么不补图片文件</Sub>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              本轮范围是只做前端。往 <span className="tnum">public/uploads/</span>{' '}
              塞几张图能让页面好看，但那是伪造后端 fixture，
              会让「图片链路是否真的通」这个问题被掩盖到上线以后。
            </p>
          </Inset>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- 数据行 */

function RowSection({ index }: { index: number }) {
  const activeItems = SAMPLE_ITEMS.filter((item) => item.status !== 'ARCHIVED');
  const archivedItems = SAMPLE_ITEMS.filter((item) => item.status === 'ARCHIVED');

  return (
    <Section
      id="rows"
      index={index}
      title="数据行"
      desc="集市用单列密集行表而不是卡片网格：一屏能放下更多物品，也更接近工具而不是商城首页。申请行则是一个状态机控制台。下面这些行的数据是用真实 schema parse 过的。"
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              eyebrow="ACTIVE / RESERVED"
              title="物品集市"
              desc="在架不渲染状态徽标，已预约才给警示色。"
              action={
                <span className="tnum text-[11.5px] text-ink-3">{activeItems.length} 行</span>
              }
            />
            <Stagger className="divide-y divide-line">
              {activeItems.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </Stagger>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              eyebrow="ARCHIVED"
              title="已归档"
              desc="归档行保留价格，用于看板的成交价分布。"
            />
            <Stagger className="divide-y divide-line">
              {archivedItems.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </Stagger>
          </Panel>
        </div>

        <Panel className="overflow-hidden">
          <PanelHeader
            eyebrow="STATE MACHINE"
            title="我的申请"
            desc="联系方式只在已接受 / 已完成时揭示；为 null 时明说对方未填写，不留空槽。"
          />
          <Stagger className="divide-y divide-line">
            {SAMPLE_CLAIMS.map((claim) => {
              const item = SAMPLE_ITEM_BY_ID.get(claim.itemId);
              return (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  variant="received"
                  item={
                    item
                      ? { name: item.name, category: item.category, coverUrl: item.coverUrl }
                      : null
                  }
                  actions={
                    claim.status === 'PENDING' ? (
                      <>
                        <Button size="sm">拒绝</Button>
                        <Button size="sm" variant="accent">
                          接受
                        </Button>
                      </>
                    ) : claim.status === 'ACCEPTED' ? (
                      <Button size="sm" variant="primary">
                        <Check size={14} aria-hidden />
                        标记完成
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </Stagger>
        </Panel>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 图表 */

const CATEGORY_DATA = [
  { label: '家电', value: 2 },
  { label: '母婴用品', value: 1 },
  { label: '家居', value: 1 },
  { label: '图书', value: 1 },
];

function ChartSection({ index }: { index: number }) {
  const pricePoints = SAMPLE_ITEMS.filter(
    (item) => item.status === 'ARCHIVED' && item.tradeType === 'FIXED_PRICE' && item.price !== null,
  ).map((item) => ({
    id: item.id,
    price: item.price ?? 0,
    label: item.name,
  }));

  return (
    <Section
      id="chart"
      index={index}
      title="图表"
      desc={
        <>
          零依赖手写，不装 recharts。分布条用 <span className="tnum">width:N%</span> 的 div 而不是
          SVG，省去 <span className="tnum">preserveAspectRatio</span> 带来的文字拉伸。
          一个系列绝不出现第二个色相。
        </>
      }
    >
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="在架物品" value="4" unit="件" hint="当前社区 ACTIVE" />
        <StatTile label="本月发布" value="12" unit="件" hint="按 Asia/Shanghai 分桶" />
        <StatTile label="我的申请" value="5" unit="条" hint="覆盖 4 种状态" />
        <StatTile label="社区完成数" value="—" partial={{ loaded: 500, total: 1284 }} />
      </Stagger>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="p-5">
          <PanelHeader
            className="border-0 px-0 pt-0 pb-4"
            eyebrow="DISTRIBUTION"
            title="品类分布"
            desc="条宽按最大值归一，占比写在数值列。"
          />
          <BarSeries data={CATEGORY_DATA} total={5} />
        </Panel>

        <Panel className="p-5">
          <PanelHeader
            className="border-0 px-0 pt-0 pb-4"
            eyebrow="PRICE · STRIP PLOT"
            title="成交价分布"
            desc="刻意选 strip plot 而非直方图。"
          />
          <PriceStrip points={pricePoints} />
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            种子里归档的计价物品只有 <span className="tnum">2</span> 件。
            两根柱子的直方图看起来像坏了，两道刻度的 strip plot 看起来是稀疏但正确 ——
            这正是选它的原因。箱体给出 Q1 / 中位 / Q3，价格轴强制从 0 起。
          </p>
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <PanelHeader
            className="border-0 px-0 pt-0 pb-4"
            eyebrow="FRESHNESS RIBBON"
            title="新鲜度构成"
            desc="直接取服务端 freshness.code 分桶，不可能与后端口径冲突。"
          />
          <FreshnessRibbon
            segments={[
              { code: 'JUST_LISTED', label: '刚刚上架', count: 1 },
              { code: 'NEW', label: '较新', count: 1 },
              { code: 'OLDER', label: '较早', count: 3 },
            ]}
          />
        </Panel>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- 契约缺口 */

const GAPS = [
  {
    section: '§3',
    endpoint: 'POST /api/uploads',
    existsInstead:
      '发布页因此不提供图片上传，封面由品类着色的排版盘生成。物品的其余字段全部可写，发布流程完整。',
  },
  {
    section: '§2',
    endpoint: 'GET /api/me/items',
    existsInstead:
      '「我的发布」改用 GET /api/items 翻页后按 owner 过滤；ItemDto 未暴露 ownerId，所以只能做到当前页近似，页面会标明口径。',
  },
  {
    section: '§5',
    endpoint: 'POST /api/items/:id/favorite',
    existsInstead: '收藏页不提供开关。ItemDto 已带 favoriteCount，可以只读展示，但种子里是 0 行。',
  },
  {
    section: '§5',
    endpoint: 'GET /api/items/:id/messages',
    existsInstead:
      '详情页没有留言板。申请本身带 message 字段，沟通通过「我的申请」里的联系方式完成。',
  },
  {
    section: '§6',
    endpoint: 'GET /api/me/notifications',
    existsInstead:
      '通知行后端已经在写（claims/service.ts 五处 + 种子四条），只是没有读取接口。通知页从 me/claims 的状态与时间戳诚实重建。',
  },
  {
    section: '§7',
    endpoint: 'GET /api/stats/community',
    existsInstead:
      '看板改为翻 GET /api/items 自行聚合，可算出在架数、本月发布、品类与成交价分布；社区级完成数与最快交接无从得知，标为缺口。',
  },
] as const;

function GapSection({ index }: { index: number }) {
  return (
    <Section
      id="gap"
      index={index}
      title="契约缺口"
      desc={
        <>
          本轮范围是「只做前端，不补后端」，所以缺失的接口不是要藏起来的破口，而是一份可见的审计。
          六处复用同一套版式：下沉表面 + 2px accent 左规则线 + 全大写眉标 + 等宽方法路径 +
          一句正常语序说明<strong className="font-semibold text-ink">已经存在什么</strong>。
          刻意不加警告三角、不用红色、不出现「错误」字样。
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {GAPS.map((gap) => (
          <ContractGap
            key={gap.endpoint}
            section={gap.section}
            endpoint={gap.endpoint}
            existsInstead={gap.existsInstead}
          />
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ 空态与骨架 */

function EmptySection({ index }: { index: number }) {
  const [page, setPage] = React.useState(3);
  const [pageDemo, setPageDemo] = React.useState<'many' | 'single'>('many');

  return (
    <Section
      id="empty"
      index={index}
      title="空态与骨架"
      desc="空态必须区分「筛选后没有结果」和「本社区确实没有」—— 前者给清除筛选的动作，后者不该让人以为是 bug。骨架的形状必须与被替代内容一致，否则加载完成时会发生布局位移。"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader eyebrow="FILTERED · 可恢复" title="筛选无结果" />
          <EmptyState
            icon={Search}
            title="没有匹配「电动车」的物品"
            desc="临风小区当前有 4 件在架物品，试着放宽筛选条件。"
            action={
              <>
                <Button size="sm" variant="secondary">
                  清除筛选
                </Button>
                <Button size="sm" variant="accent">
                  发布这件物品
                </Button>
              </>
            }
          />
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader eyebrow="TRUE EMPTY · 不可恢复" title="本社区确无在架物品" />
          <EmptyState
            icon={Package}
            title="临风小区还没有在架物品"
            desc="成为第一个发布者。发布只需要名称与交易方式，两分钟内可以完成。"
            action={
              <Button size="sm" variant="accent">
                发布第一件物品
              </Button>
            }
          />
        </Panel>

        <Panel className="overflow-hidden lg:col-span-2">
          <PanelHeader
            eyebrow="SKELETON"
            title="列表加载态"
            desc="外壳不动，只有内容列出骨架 —— 这是鉴权门禁不产生白屏与闪内容的关键。"
          />
          <div className="divide-y divide-line">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        </Panel>

        <div className="space-y-5 lg:col-span-2">
          <Panel className="overflow-hidden">
            <PanelHeader
              eyebrow="PAGINATION"
              title="数字分页"
              desc="总量是服务端已知的确定值，所以不用「加载更多」把它藏起来。首尾恒定可见，中间用省略号收拢。"
              action={
                <Segmented
                  ariaLabel="分页演示场景"
                  size="sm"
                  value={pageDemo}
                  onChange={setPageDemo}
                  options={[
                    { value: 'many', label: '多页' },
                    { value: 'single', label: '单页' },
                  ]}
                />
              }
            />
            {pageDemo === 'single' ? (
              <Pagination
                page={1}
                totalPages={1}
                total={4}
                onChange={() => undefined}
                className="border-t border-line"
              />
            ) : (
              <Pagination
                page={page}
                totalPages={9}
                total={171}
                onChange={setPage}
                className="border-t border-line"
              />
            )}
          </Panel>

          <Panel className="p-5">
            <Sub>其他骨架形状</Sub>
            <div className="flex flex-wrap items-center gap-4">
              <Skeleton className="size-16 rounded-md" />
              <div className="min-w-[12rem] flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-2.5 w-3/5" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </Panel>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 动效 */

const MOTION_TOKENS = [
  { name: '--ease', usage: '全站唯一一条曲线' },
  { name: '--dur-fast', usage: '悬浮 / 按下的颜色反馈' },
  { name: '--dur', usage: '状态切换、入场、位移' },
  { name: '--dur-slow', usage: '滑动指示、高度揭示、图表绘制' },
] as const;

const MOTION_BARS = [
  { label: '书籍教材', value: 7 },
  { label: '小家电', value: 5 },
  { label: '母婴用品', value: 4 },
  { label: '运动户外', value: 2 },
];

const STAGGER_ROWS = [
  ['09-29 01:48', '闲置婴儿推车', '刚刚上架'],
  ['09-28 22:10', '宜家台灯', '较新'],
  ['09-28 19:02', '小米空气净化器 2S', '较早'],
  ['09-27 20:41', '折叠书桌', '较早'],
  ['09-26 08:15', '羽毛球拍一对', '较早'],
  ['09-24 09:00', '大学教材若干', '较早'],
];

const REVEAL_CLAIM = SAMPLE_CLAIMS.find((claim) => claim.status === 'ACCEPTED');
const HOVER_ITEM = SAMPLE_ITEMS[0];

const SEGMENT_DEMO = [
  { value: 'new', label: '最新' },
  { value: 'price', label: '价格' },
  { value: 'soon', label: '最快交接' },
] as const;

/** 演示用的重放：换 key 让子树重挂载，一次性动画因此可以再跑一遍。 */
function useReplay() {
  const [nonce, setNonce] = React.useState(0);
  const replay = React.useCallback(() => setNonce((value) => value + 1), []);
  return [nonce, replay] as const;
}

function Replay({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <RotateCcw size={13} aria-hidden />
      重放
    </Button>
  );
}

function MotionSection({ index }: { index: number }) {
  const [tokens, setTokens] = React.useState<ReadonlyMap<string, string>>(new Map());
  const [sort, setSort] = React.useState<(typeof SEGMENT_DEMO)[number]['value']>('new');
  const [open, setOpen] = React.useState(true);
  const [staggerNonce, replayStagger] = useReplay();
  const [chartNonce, replayChart] = useReplay();
  const [routeNonce, replayRoute] = useReplay();

  // 从计算样式里读真实值，保证这份文档不可能和 globals.css 漂移
  React.useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const next = new Map<string, string>();
    for (const token of MOTION_TOKENS) {
      next.set(token.name, style.getPropertyValue(token.name).trim() || '—');
    }
    setTokens(next);
  }, []);

  return (
    <Section
      id="motion"
      index={index}
      title="动效"
      desc={
        <>
          一条曲线、三档时长，全部纯 CSS。动效只用来交代
          <strong className="font-semibold text-ink">「状态从哪来、到哪去」</strong>
          ：滑动指示说明选择移动了方向，高度揭示说明内容是被展开的，绘制说明数据是刚到的。
          没有装饰性循环动画，每条都是一次性；
          <span className="tnum">prefers-reduced-motion: reduce</span> 下统一压到 0.01ms。
        </>
      }
    >
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {MOTION_TOKENS.map((token, position) => (
            <div
              key={token.name}
              className={cn('px-5 py-3.5', position > 0 && 'sm:border-l sm:border-line')}
            >
              <div className="tnum text-[12px] font-medium text-ink">{token.name}</div>
              <div className="tnum mt-0.5 text-[11.5px] text-accent">
                {tokens.get(token.name) ?? '—'}
              </div>
              <div className="mt-1 text-[11.5px] text-ink-3">{token.usage}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel className="flex flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <Sub>入场 · 错峰 24ms</Sub>
            <Replay onClick={replayStagger} />
          </div>
          <Stagger key={staggerNonce} className="-mx-2 divide-y divide-line">
            {STAGGER_ROWS.map(([time, name, freshness]) => (
              <div key={time} className="flex items-baseline gap-3 px-2 py-2">
                <span className="tnum shrink-0 text-[11px] text-ink-3">{time}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{name}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{freshness}</span>
              </div>
            ))}
          </Stagger>
          <p className="mt-auto pt-3 text-[12px] leading-relaxed text-ink-3">
            列表容器套一层 <span className="tnum">&lt;Stagger&gt;</span>：子元素按
            <span className="tnum"> nth-child </span>递延 24ms，不需要 JS 计数，进视口才开始播。 第
            13 个之后不再继续延后，长列表尾端不用等。
          </p>
        </Panel>

        <Panel className="flex flex-col p-5">
          <Sub>滑动指示 · 260ms</Sub>
          <Segmented
            value={sort}
            onChange={setSort}
            options={SEGMENT_DEMO}
            ariaLabel="排序方式（动效演示）"
          />
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            选中态是一片滑动的白底，不是逐格切换背景 —— 于是「从最新换到价格」这个方向被看见了。
            侧栏那根 2px accent 规则线用同一条曲线滑到新位置，跨分组也连续。
          </p>
          <div className="mt-auto pt-3">
            <div className="label-xs">当前值</div>
            <div className="tnum mt-1 text-[12.5px] text-ink">{sort}</div>
          </div>
        </Panel>

        <Panel className="flex flex-col p-5">
          <Sub>高度揭示 · 260ms</Sub>
          <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? '撤回接受' : '接受申请'}
          </Button>
          {REVEAL_CLAIM && (
            <ClaimRow
              className="-mx-2 mt-3"
              claim={{
                ...REVEAL_CLAIM,
                status: open ? 'ACCEPTED' : 'PENDING',
                acceptedAt: open ? REVEAL_CLAIM.acceptedAt : null,
              }}
              item={{ name: '宜家台灯', category: '家居', coverUrl: null }}
              variant="received"
            />
          )}
          <p className="mt-auto pt-3 text-[12px] leading-relaxed text-ink-3">
            <span className="tnum">grid-template-rows: 0fr → 1fr</span>
            ，不需要 JS 量高度，开与合两个方向都有动效。
          </p>
        </Panel>

        <Panel className="flex flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <Sub>图表绘制 · 260ms</Sub>
            <Replay onClick={replayChart} />
          </div>
          <BarSeries key={chartNonce} data={MOTION_BARS} total={18} />
          <p className="mt-auto pt-3 text-[12px] leading-relaxed text-ink-3">
            首帧用 <span className="tnum">transform</span> 从 0 画出（不触发重排）；
            <span className="tnum">width</span>{' '}
            也在过渡里，所以换筛选条件时条形是长过去的，不是跳过去的。 绘制由 IntersectionObserver
            触发，首屏之下的图表不会在你看到之前就放完。
          </p>
        </Panel>

        <Panel className="flex flex-col p-5">
          <Sub>悬浮与按下 · 110ms</Sub>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">按下我</Button>
            <Button variant="accent">悬浮我</Button>
            <Button variant="secondary">悬浮我</Button>
            <IconButton label="搜索（动效演示）" icon={Search} variant="secondary" />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            <span className="tnum">active:translate-y-px</span> 模拟纸面被按下去；
            刻意不用缩放，缩放会让按钮显得像橡胶。
          </p>
          <div className="mt-auto pt-3">
            <div className="label-xs">路由切换 · 170ms</div>
            <div key={routeNonce} className="anim-rise mt-1.5 flex items-center gap-2">
              <span className="tnum text-[12.5px] text-ink">内容列上浮 4px</span>
              <Replay onClick={replayRoute} />
            </div>
          </div>
        </Panel>

        <Panel className="flex flex-col p-5">
          <Sub>行级悬浮 · 170ms</Sub>
          <p className="text-[12px] leading-relaxed text-ink-3">
            悬浮一行时：底色变浅、封面盘描边加深、行尾箭头从左侧 4px 处滑入。 箭头槽位常驻{' '}
            <span className="tnum">w-4</span>，所以出现时不推挤任何文字； 移动端不渲染它，因为没有
            hover。
          </p>
          <div className="mt-auto pt-3">
            <div className="label-xs">一次性，不循环</div>
            <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-ink-2">
              <li>入场 / 揭示 / 绘制都只跑一次</li>
              <li>唯一的循环是骨架扫光，它是加载指示</li>
              <li>不装 framer-motion，不用弹跳 spring</li>
            </ul>
          </div>
        </Panel>

        {HOVER_ITEM && (
          <Panel className="overflow-hidden lg:col-span-3">
            <PanelHeader
              eyebrow="HOVER"
              title="把指针放到这一行上"
              desc="底色、封面描边、行尾箭头三处同时响应，共用一条曲线与同一档时长。"
            />
            <div className="divide-y divide-line">
              <ItemRow item={HOVER_ITEM} />
            </div>
          </Panel>
        )}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- 刻意回避 */

const AVOID = [
  ['渐变文字标题', '单一墨色 + 字重对比'],
  ['极光模糊光斑背景', '纯纸色底，必要时 48px 网格线'],
  ['玻璃拟态与大面积模糊', '1px 发丝线围合空间'],
  ['emoji 当图标', 'lucide 线性图标，1.75 描边'],
  ['rounded-3xl 大圆角', '3–14px 小圆角'],
  ['弹跳 spring 与缩放', '一条曲线 cubic-bezier(.2,0,0,1)，110/170/260ms 三档'],
  ['彩带 / 跑马灯 / 无限循环', '动效全部一次性，只交代状态从哪来、到哪去'],
  ['深浅色主题切换开关', '只做浅色，省下的力气给排版'],
  ['多色分类彩虹图表', '一个系列一个色相'],
  ['卡片投影堆叠', '阴影只给浮层（下拉 / toast）'],
] as const;

function AvoidSection({ index }: { index: number }) {
  return (
    <Section
      id="avoid"
      index={index}
      title="刻意回避"
      desc="这些是 AI 生成界面最常见的视觉惯例，也是「一眼假」的来源。左边是回避项，右边是这个项目里取而代之的做法。"
    >
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 border-b border-line">
          <div className="label-xs px-5 py-2.5">回避</div>
          <div className="label-xs border-l border-line px-5 py-2.5">采用</div>
        </div>
        <div className="divide-y divide-line">
          {AVOID.map(([avoid, adopt]) => (
            <div key={avoid} className="grid grid-cols-2">
              <div className="px-5 py-2.5 text-[12.5px] text-ink-3 line-through decoration-danger/45">
                {avoid}
              </div>
              <div className="border-l border-line px-5 py-2.5 text-[12.5px] font-medium text-ink">
                {adopt}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Inset>
          <Sub>技术选型</Sub>
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-ink-2">
            <li>Tailwind v4 + CSS 变量令牌</li>
            <li>React Query v5</li>
            <li>react-hook-form + zod</li>
            <li>lucide-react / sonner</li>
            <li>cva + clsx + tailwind-merge</li>
          </ul>
        </Inset>
        <Inset>
          <Sub>不装的东西</Sub>
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-ink-2">
            <li>framer-motion（动效用纯 CSS）</li>
            <li>canvas-confetti</li>
            <li>recharts（图表手写）</li>
            <li>next-themes（只做浅色）</li>
            <li>autoprefixer（v4 已内置）</li>
          </ul>
        </Inset>
        <Inset>
          <Sub>纪律</Sub>
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-ink-2">
            <li>类型一律来自 schema 的 z.infer</li>
            <li>时间差与新鲜度只由服务端算</li>
            <li>缺失接口显式标注，不伪造成功</li>
            <li>cva 只用于真有 ≥3 变体处</li>
            <li>动效只动 transform / opacity / 尺寸，绝不用来藏内容</li>
            <li>永不用非空断言 !</li>
          </ul>
        </Inset>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- 页 */

export function StyleGuide() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="STYLE BASELINE · 风格基线"
        title="纸墨与松绿"
        desc="邻里流转前端的视觉与交互基线。这一页不接任何后端数据，所有样例都用 src/shared/schemas.ts 的真实 schema parse 过，因此样例形状一旦与契约漂移就会直接抛错而不是悄悄显示错数据。"
        actions={
          <span className="tnum rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
            步骤 1 / 8
          </span>
        }
      />

      <nav aria-label="本页区块" className="mb-9 flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'text-[12px] font-normal',
            )}
          >
            {section.label}
          </a>
        ))}
      </nav>

      <TypeSection index={1} />
      <ColorSection index={2} />
      <ButtonSection index={3} />
      <FormSection index={4} />
      <BadgeSection index={5} />
      <PanelSection index={6} />
      <CoverSection index={7} />
      <RowSection index={8} />
      <ChartSection index={9} />
      <GapSection index={10} />
      <EmptySection index={11} />
      <MotionSection index={12} />
      <AvoidSection index={13} />

      <footer className="mt-10 border-t border-line pt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-ink-3">
          <span className="label-xs font-mono">END OF BASELINE</span>
          <span>共 {SECTIONS.length} 个区块</span>
          <span className="tnum">Tailwind v4 · React 19 · Next 15</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Sparkles size={12} aria-hidden />
              AI 面板在第 7 步
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare size={12} aria-hidden />
              留言板为契约缺口
            </span>
            <span className="flex items-center gap-1">
              <Wand2 size={12} aria-hidden />
              润色逐字段采用
            </span>
            <span className="flex items-center gap-1">
              <Inbox size={12} aria-hidden />
              通知从 me/claims 重建
            </span>
            <span className="flex items-center gap-1">
              <ImageIcon size={12} aria-hidden />
              上传缺失
            </span>
            <span className="flex items-center gap-1">
              <Heart size={12} aria-hidden />
              收藏缺失
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
