'use client';

import Link from 'next/link';
import { ArrowRight, LayoutDashboard, Lock, Plus, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FilterBar, type FilterValue } from '@/components/FilterBar';
import { ItemCard } from '@/components/ItemCard';
import { Button, EmptyState, SectionTitle, Skeleton, Stat } from '@/components/ui';
import { useItems } from '@/hooks/use-items';
import { ApiError } from '@/lib/api';

export default function HomePage() {
  const [filter, setFilter] = useState<FilterValue>({
    q: '',
    tradeType: '',
    freshness: '',
    sort: 'latest',
  });
  const [page, setPage] = useState(1);
  const query = useMemo(
    () => ({
      ...filter,
      tradeType: filter.tradeType || undefined,
      freshness: filter.freshness || undefined,
      q: filter.q || undefined,
      page,
      pageSize: 12,
    }),
    [filter, page],
  );
  const { data, isLoading, isFetching, error } = useItems(query);
  const notAuth = error instanceof ApiError && (error.isAuth || error.code === 'UNAUTHENTICATED');
  const items = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 12));

  return (
    <div className="space-y-12">
      {/*
        首屏。上一版是整块 `bg-stone-950` 深色 hero + `lime-300` 荧光数字 + 三个
        emoji 小卡，问题有三层：深色块把页面上半截和下半截撕成两半；荧光色让
        数字比标题更抢眼；emoji 在同一行里大小和基线都不可控。
        现在是一段纯排版：标题、说明、两个操作、三个中性计数。
      */}
      <section>
        <h1 className="max-w-2xl text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-4xl">
          让闲置在沉没之前被看到。
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-[1.65] text-ink-secondary">
          小区内部的闲置流转：发布、想要、约面交、归档。不用快递，就在隔壁楼。
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link href="/items/new">
            <Button size="lg">
              <Plus size={16} /> 发布闲置
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button size="lg" variant="secondary">
              <LayoutDashboard size={16} /> 社区看板
              <ArrowRight size={14} className="text-ink-tertiary" />
            </Button>
          </Link>
        </div>
        <div className="mt-8 flex items-center gap-8 border-t border-line pt-5">
          <Stat label="当前在售" value={total} />
          <Stat label="本页想要" value={items.reduce((s, i) => s + i.claimCount, 0)} />
          <Stat label="本页收藏" value={items.reduce((s, i) => s + i.favoriteCount, 0)} />
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle kicker="新鲜流转" title="当前可领取" />
        <FilterBar
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-lg border border-line bg-surface p-3">
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : notAuth ? (
          <EmptyState
            icon={<Lock size={18} />}
            title="加入小区后可见物品流"
            hint="会话是 HttpOnly Cookie，物品流需要成员身份。"
            action={
              <Link href="/join">
                <Button size="lg">加入小区</Button>
              </Link>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Search size={18} />}
            title="没有匹配的物品"
            hint="换个关键词或筛选条件，或者成为第一个发布的人。"
            action={
              <Link href="/items/new">
                <Button>去发布</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
            <div className="flex items-center justify-center gap-3 pt-2 text-[13px]">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-ink-tertiary tabular">
                {page} / {totalPages} · 共 {total} 件
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </>
        )}
      </section>

      {/*
        AI 能力。上一版是三张 `stone-950` 深卡套渐变描边 + 悬浮上浮。
        这里是三行纯文字链接：AI 是辅助，不是主流程，不该占据三张卡的分量。
      */}
      <section className="space-y-3 border-t border-line pt-8">
        <SectionTitle
          kicker="AI 辅助"
          title="发布时可以顺手用的三件事"
          desc="都可跳过，不影响主流程。"
        />
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {[
            {
              t: '智能定价',
              d: '参考同小区成交价给出区间，或建议直接免费送出',
              href: '/items/new',
            },
            {
              t: '文案润色',
              d: '把「九成新」补成邻居看得懂的三句话',
              href: '/items/new',
            },
            {
              t: 'FAQ 自动回复',
              d: '「还在吗？」先生成草稿，发布者确认后再发出',
              href: '/requests',
            },
          ].map((a) => (
            <li key={a.t}>
              <Link
                href={a.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
              >
                <Sparkles size={15} className="shrink-0 text-ai" />
                <span className="text-sm font-medium text-ink">{a.t}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">
                  {a.d}
                </span>
                <ArrowRight size={14} className="shrink-0 text-ink-tertiary" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/*
        流程说明。上一版用 `📸💬🤝` 三个 emoji 配 48px 灰色序号当装饰，
        实际上流程只需要编号和文字，emoji 一点信息量都没增加。
      */}
      <section className="pb-4">
        <div className="grid gap-6 border-t border-line pt-8 sm:grid-cols-3">
          {[
            { n: '01', t: '发布', d: '拍照、写描述、定价，AI 可代劳润色与估价。' },
            { n: '02', t: '想要', d: '点「想要」留下留言，公开问答代替反复私聊。' },
            { n: '03', t: '归档', d: '面交完成，发布者标记已送出，看板实时更新。' },
          ].map((s) => (
            <div key={s.n}>
              <div className="text-xs font-medium text-ink-tertiary tabular">{s.n}</div>
              <div className="mt-1 text-sm font-medium text-ink">{s.t}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
