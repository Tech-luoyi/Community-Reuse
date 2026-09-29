'use client';

import Link from 'next/link';
import { ArrowRight, Bot, LayoutDashboard, PlusCircle, Sparkles, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FilterBar, type FilterValue } from '@/components/FilterBar';
import { ItemCard } from '@/components/ItemCard';
import { Button, EmptyState, SectionTitle, Skeleton } from '@/components/ui';
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
    <div className="space-y-8">
      {/* ---------- HERO ---------- */}
      {/*
        品牌区。原先这里有：两团 `blur-[80px]` 且无限往复的光斑、四张悬浮卡片
        （各自 `repeat: Infinity` 地上下浮动 + `backdrop-blur-xl`）、一条无限滚动的跑马灯，
        以及逐元素延迟入场动画。它们共同构成"永远在动的整屏合成"，是首页掉帧的主因，
        也是页面读起来嘈杂的来源。现在只留静态排版与三个真实计数。
      */}
      <section className="relative overflow-hidden rounded-[2rem] bg-stone-950 p-7 text-white sm:p-9">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-lime-300">
          本小区熟人流转 · 不用快递 · 就在隔壁楼
        </div>
        <h1 className="mt-4 max-w-2xl text-4xl font-black leading-[1.12] tracking-tight sm:text-5xl">
          让闲置在<span className="text-lime-300">沉没之前</span>被看到。
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-stone-300">
          业主群消息刷得太快？定价拿不准？约时间总被鸽？邻里流转把发布 → 想要 → 约面交 →
          归档做成一条顺滑闭环，还附赠 AI 定价 / 文案润色 / FAQ 自动回复。
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Link href="/items/new">
            <Button variant="accent" size="lg">
              <PlusCircle size={18} /> 发布一件闲置
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button size="lg" className="bg-white/10 text-white hover:bg-white/20">
              <LayoutDashboard size={18} /> 看看社区看板 <ArrowRight size={16} />
            </Button>
          </Link>
        </div>
        <div className="mt-6 grid max-w-md grid-cols-3 gap-3">
          {[
            { label: '当前在售', v: total, icon: '📦' },
            { label: '本页想要数', v: items.reduce((s, i) => s + i.claimCount, 0), icon: '🤝' },
            { label: '本页收藏数', v: items.reduce((s, i) => s + i.favoriteCount, 0), icon: '❤️' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/[.07] p-3">
              <div className="text-lg">{s.icon}</div>
              <div className="text-xl font-black tabular-nums text-lime-300">{s.v}</div>
              <div className="text-[11px] font-bold text-stone-400">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- LIST ---------- */}
      <section className="space-y-4">
        <SectionTitle
          kicker="新鲜流转"
          title={
            <>
              当前可领 <span className="text-emerald-600">新鲜好物</span>
            </>
          }
          desc="按新鲜度排序：24h 内刚上架 → 72h 内新上架 → 更早。归档物品只在归档视图出现。"
        />
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
              <div
                key={i}
                className="space-y-2 rounded-3xl border border-stone-200/60 bg-white/70 p-3"
              >
                <Skeleton className="h-44" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        ) : notAuth ? (
          <EmptyState
            emoji="🔐"
            title="凭邀请码加入后可见物品流"
            hint="会话是 HttpOnly Cookie；GET /api/items 需要成员身份（多租户红线）。"
            action={
              <Link href="/join">
                <Button variant="accent" size="lg">
                  加入小区（种子码 LINFENG-2026）
                </Button>
              </Link>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            emoji="📭"
            title="这里空空如也"
            hint="换个关键词或筛选试试，或者成为第一个发布的人。"
            action={
              <Link href="/items/new">
                <Button variant="accent">去发布</Button>
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
            <div className="flex items-center justify-center gap-3 pt-2 text-sm font-bold">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← 上一页
              </Button>
              <span className="text-stone-500">
                {page} / {totalPages} · 共 {total} 件
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页 →
              </Button>
            </div>
          </>
        )}
      </section>

      {/* ---------- AI STRIP ---------- */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: <TrendingUp size={18} />,
            t: 'AI 智能定价',
            d: '查同小区成交价，给区间或建议免费',
            c: 'from-emerald-500 to-teal-500',
            href: '/items/new',
          },
          {
            icon: <Sparkles size={18} />,
            t: 'AI 文案润色',
            d: '粗糙描述一键变熟人社区爆款文案',
            c: 'from-orange-500 to-amber-500',
            href: '/items/new',
          },
          {
            icon: <Bot size={18} />,
            t: 'AI FAQ 回复',
            d: '“还在吗？”自动生成可发送回复',
            c: 'from-violet-500 to-fuchsia-500',
            href: '/requests',
          },
        ].map((a) => (
          <Link
            key={a.t}
            href={a.href}
            className={`block rounded-3xl bg-gradient-to-br ${a.c} p-[1.5px] shadow-lg transition-transform duration-200 ease-out hover:-translate-y-1`}
          >
            <div className="rounded-3xl bg-stone-950/[.92] p-4 text-white">
              <div className="flex items-center gap-2 text-sm font-black">
                <span
                  className={`grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br ${a.c}`}
                >
                  {a.icon}
                </span>
                {a.t}
              </div>
              <div className="mt-1.5 text-xs leading-relaxed text-stone-400">{a.d}</div>
            </div>
          </Link>
        ))}
      </section>

      {/* ---------- STEPS ---------- */}
      <section className="grid gap-3 pb-4 md:grid-cols-3">
        {[
          { n: '01', t: '发布 30 秒', d: '拍照 → AI 润色文案 → AI 建议定价，一键上架。', e: '📸' },
          { n: '02', t: '想要一键达', d: '浏览者点“想要”，留言板公开问答代替重复私聊。', e: '💬' },
          { n: '03', t: '面交秒归档', d: '约楼下面交，发布者标记已送出，看板实时 +1。', e: '🤝' },
        ].map((s) => (
          <div
            key={s.n}
            className="rounded-3xl border border-stone-200/70 bg-white p-5 transition-transform duration-200 ease-out hover:-translate-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-3xl">{s.e}</span>
              <span className="text-3xl font-black text-stone-200">{s.n}</span>
            </div>
            <div className="mt-2 font-black">{s.t}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-stone-500">{s.d}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
