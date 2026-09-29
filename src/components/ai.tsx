'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Loader2, Send, Sparkles, TrendingUp, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { post } from '@/lib/api';
import { Badge, Button, Textarea } from './ui';
import { messageBoardKey } from './MessageBoard';
import type { FaqResult, PolishResult, PricingResult, TradeType } from '@/shared/types';

function MetaLine({
  r,
}: {
  r: { degraded: boolean; source: string; usedTools: boolean; toolCalls: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
      <Badge
        className={r.degraded ? 'bg-stone-200 text-stone-600' : 'bg-emerald-100 text-emerald-700'}
      >
        {r.degraded ? '📴 离线建议' : r.source === 'cache' ? '⚡ 缓存命中' : '🤖 模型生成'}
      </Badge>
      {r.usedTools && (
        <Badge className="bg-violet-100 text-violet-700">🔧 查了本小区成交 · ×{r.toolCalls}</Badge>
      )}
    </div>
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
    <div className="rounded-3xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/80 to-white p-4">
      <div className="flex items-center gap-2 text-sm font-black">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
          <TrendingUp size={16} />
        </span>
        AI 智能定价
        <span className="ml-auto rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-white">
          工具调用版
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="物品名称，如 九成新婴儿车"
          className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="补充描述（可选）：品牌、成色…"
          className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
        />
        <Button variant="accent" size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? '正在查本小区成交…' : '获取定价建议'}
        </Button>
      </div>
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 space-y-2 rounded-2xl bg-white p-3 shadow-sm"
          >
            <MetaLine r={result} />
            <div className="text-lg font-black">
              {result.mode === 'FREE'
                ? '🎁 建议免费送'
                : `💰 ¥${result.priceRange?.min} – ¥${result.priceRange?.max}`}
            </div>
            <p className="text-xs leading-relaxed text-stone-500">{result.reason}</p>
            {onApply && result.mode === 'PRICED' && result.priceRange && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onApply(result);
                  toast.success('已填入价格 ✨');
                }}
              >
                采用建议价 ¥{Math.round((result.priceRange.min + result.priceRange.max) / 2)}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
    <div className="rounded-3xl border border-orange-200/70 bg-gradient-to-b from-orange-50/80 to-white p-4">
      <div className="flex items-center gap-2 text-sm font-black">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white">
          <Wand2 size={16} />
        </span>
        AI 文案润色
      </div>
      <div className="mt-3 grid gap-2">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="随便写几句，如：车子还能用，轮子好…"
          rows={2}
        />
        <Button variant="warm" size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {loading ? '正在润色…' : '一键润色'}
        </Button>
      </div>
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 space-y-2 rounded-2xl bg-white p-3 shadow-sm"
          >
            <MetaLine r={result} />
            <div className="font-black">{result.title}</div>
            <p className="text-xs leading-relaxed text-stone-600">{result.description}</p>
            <div className="flex flex-wrap gap-1">
              {result.highlights.map((h) => (
                <span
                  key={h}
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"
                >
                  ✦ {h}
                </span>
              ))}
            </div>
            {onApply && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onApply(result);
                  toast.success('已填入表单 ✨');
                }}
              >
                采用这版文案
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FaqAssistant({ itemId, tradeType }: { itemId: string; tradeType: TradeType }) {
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
      toast.success('已发送到留言板 🤖');
      setResult(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-3xl border border-violet-200/70 bg-gradient-to-b from-violet-50/80 to-white p-4">
      <div className="flex items-center gap-2 text-sm font-black">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <Bot size={16} />
        </span>
        AI FAQ 自动回复
        <span className="ml-auto text-[11px] font-bold text-stone-400">交易方式: {tradeType}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['还在吗？', '能否自提？', '能刀吗？', '几成新？'].map((s) => (
          <button
            key={s}
            onClick={() => setQ(s)}
            className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${q === s ? 'bg-violet-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 flex-1 rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
        />
        <Button
          size="sm"
          onClick={run}
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-700"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : '生成'}
        </Button>
      </div>
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 rounded-2xl bg-white p-3 shadow-sm"
          >
            <MetaLine r={result} />
            <p className="mt-1.5 text-sm font-bold leading-relaxed">“{result.answer}”</p>
            <p className="text-[11px] text-stone-400">
              置信度 {(result.confidence * 100).toFixed(0)}%
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={sendToBoard}
              disabled={sending}
            >
              <Send size={13} /> {sending ? '发送中…' : '一键发进留言板'}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
