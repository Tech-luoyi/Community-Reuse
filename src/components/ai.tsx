'use client';

import {
  Bot,
  Loader2,
  Send,
  Sparkles,
  TrendingUp,
  Wand2,
  Wrench,
  Zap,
  WifiOff,
} from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { post } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge, Button, Input, Textarea } from './ui';
import { messageBoardKey } from './MessageBoard';
import type { FaqResult, PolishResult, PricingResult } from '@/shared/types';

interface Meta {
  degraded: boolean;
  source: string;
  usedTools: boolean;
  toolCalls: number;
}

/**
 * AI 溯源行。
 *
 * 上一版是 `📴 离线建议` / `⚡ 缓存命中` / `🤖 模型生成` 三个 emoji 加 badge，
 * 每次调用返回的内容都在视觉上"跳一下"。改成图标 + 固定色调：
 * 离线 = 弱化，缓存 = 中性，模型 = AI 紫。
 */
function MetaLine({ r }: { r: Meta }) {
  const state = r.degraded
    ? { label: '离线建议', tone: 'done' as const, Icon: WifiOff }
    : r.source === 'cache'
      ? { label: '缓存命中', tone: 'info' as const, Icon: Zap }
      : { label: '模型生成', tone: 'ai' as const, Icon: Bot };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={state.tone}>
        <state.Icon size={11} />
        {state.label}
      </Badge>
      {r.usedTools && (
        <Badge tone="neutral">
          <Wrench size={11} />
          查了本小区成交 ×{r.toolCalls}
        </Badge>
      )}
    </div>
  );
}

/** 三个助手共用的外框。AI 区域统一用紫色描边，与主流程的近黑按钮视觉分离。 */
function AssistantFrame({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: typeof Bot;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-ai-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-ai-bg text-ai">
          <Icon size={15} />
        </span>
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function PricingAssistant({ onApply }: { onApply?: (r: PricingResult) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PricingResult | null>(null);

  async function run() {
    if (!name.trim()) return toast.error('先填物品名称');
    setLoading(true);
    try {
      const r = await post<PricingResult>('/api/ai/pricing', {
        name,
        description: desc || undefined,
      });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '定价失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AssistantFrame
      icon={TrendingUp}
      title="智能定价"
      aside={<span className="text-[11px] text-ink-tertiary">参考同小区成交</span>}
    >
      <div className="grid gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="物品名称，如 九成新婴儿车"
        />
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="补充描述（可选）：品牌、成色…"
        />
        <Button variant="ai" size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? '正在查本小区成交…' : '获取定价建议'}
        </Button>
      </div>

      {result && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <MetaLine r={result} />
          <p className="text-lg font-semibold tracking-[-0.01em] text-ink tabular">
            {result.mode === 'FREE'
              ? '建议免费送出'
              : `¥${result.priceRange?.min} – ¥${result.priceRange?.max}`}
          </p>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{result.reason}</p>
          {onApply && result.mode === 'PRICED' && result.priceRange && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onApply(result);
                toast.success('已填入价格');
              }}
            >
              采用 ¥{Math.round((result.priceRange.min + result.priceRange.max) / 2)}
            </Button>
          )}
        </div>
      )}
    </AssistantFrame>
  );
}

export function PolishAssistant({ onApply }: { onApply?: (r: PolishResult) => void }) {
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PolishResult | null>(null);

  async function run() {
    if (!raw.trim()) return toast.error('先写几句粗糙描述');
    setLoading(true);
    try {
      const r = await post<PolishResult>('/api/ai/polish', { rawText: raw });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '润色失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AssistantFrame icon={Wand2} title="文案润色">
      <div className="grid gap-2">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="随便写几句，如：车子还能用，轮子好…"
          rows={2}
        />
        <Button variant="ai" size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {loading ? '正在润色…' : '一键润色'}
        </Button>
      </div>

      {result && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <MetaLine r={result} />
          <p className="text-sm font-medium text-ink">{result.title}</p>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{result.description}</p>
          <div className="flex flex-wrap gap-1">
            {result.highlights.map((h) => (
              <span
                key={h}
                className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-secondary"
              >
                {h}
              </span>
            ))}
          </div>
          {onApply && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onApply(result);
                toast.success('已填入表单');
              }}
            >
              采用这版文案
            </Button>
          )}
        </div>
      )}
    </AssistantFrame>
  );
}

export function FaqAssistant({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('还在吗？');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FaqResult | null>(null);

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await post<FaqResult>('/api/ai/faq', { itemId, question: q });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function sendToBoard() {
    if (!result) return;
    setSending(true);
    try {
      // senderType='AI' 不可省略：服务端据此强制 authorId=null，前端才能把它标成「AI 建议」。
      // 若按默认 USER 投递，机器生成的回复会被读成发布者本人的话。
      await post(`/api/items/${itemId}/messages`, { content: result.answer, senderType: 'AI' });
      await qc.invalidateQueries({ queryKey: messageBoardKey(itemId) });
      toast.success('已发送到留言板');
      setResult(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <AssistantFrame
      icon={Bot}
      title="FAQ 自动回复"
      aside={<span className="text-[11px] text-ink-tertiary">发布者使用</span>}
    >
      <div className="flex flex-wrap gap-1.5">
        {['还在吗？', '能否自提？', '能刀吗？', '几成新？'].map((s) => (
          <button
            key={s}
            onClick={() => setQ(s)}
            aria-pressed={q === s}
            className={cn(
              'h-7 rounded-full border px-2.5 text-xs transition-colors',
              q === s
                ? 'border-ai bg-ai-bg text-ai'
                : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
        <Button variant="ai" size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : '生成'}
        </Button>
      </div>

      {result && (
        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          <MetaLine r={result} />
          <p className="text-[13px] leading-relaxed text-ink">“{result.answer}”</p>
          <p className="text-[11px] text-ink-tertiary tabular">
            置信度 {(result.confidence * 100).toFixed(0)}%
          </p>
          <Button size="sm" variant="secondary" onClick={sendToBoard} disabled={sending}>
            <Send size={13} /> {sending ? '发送中…' : '发进留言板'}
          </Button>
        </div>
      )}
    </AssistantFrame>
  );
}
