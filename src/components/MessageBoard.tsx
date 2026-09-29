'use client';

import { Bot, Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, EmptyState, ErrorPanel, Skeleton, Textarea } from './ui';
import { MESSAGE_CONTENT_MAX } from '@/shared/schemas';
import type { MessageDto } from '@/shared/types';

export function messageBoardKey(itemId: string) {
  return ['item-messages', itemId] as const;
}

export function MessageBoard({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const {
    data: messages,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: messageBoardKey(itemId),
    queryFn: () => get<MessageDto[]>(`/api/items/${itemId}/messages`),
  });

  async function submit() {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      await post<MessageDto>(`/api/items/${itemId}/messages`, { content });
      setDraft('');
      await qc.invalidateQueries({ queryKey: messageBoardKey(itemId) });
      toast.success('已发布到留言板');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}

      {isError && !isLoading && (
        <ErrorPanel
          title="留言板加载失败"
          hint="接口已就位，读不到就是出错了 —— 不降级成「还没有人提问」。"
          onRetry={() => void refetch()}
          fetching={isFetching}
        />
      )}

      {messages?.length === 0 && !isLoading && !isError && (
        <EmptyState
          emoji="💬"
          title="还没有人提问"
          hint="把「还在吗」「几成新」问在这里，下一个人就不用再私聊一遍。"
        />
      )}

      {!!messages?.length && (
        <ul className="space-y-2.5">
          {messages.map((m) => (
            <li key={m.id} className="flex gap-2.5">
              {m.senderType === 'AI' ? (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                  <Bot size={15} />
                </span>
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-900 text-[11px] font-black text-white">
                  {(m.author?.nickname ?? '?').slice(0, 1)}
                </span>
              )}
              <div className="min-w-0 flex-1 rounded-2xl bg-stone-50 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  <span className="font-black text-stone-700">
                    {m.senderType === 'AI' ? '发布者代发' : (m.author?.nickname ?? '未知')}
                  </span>
                  {m.senderType === 'AI' && (
                    <Badge className="bg-violet-100 text-violet-700">AI 建议</Badge>
                  )}
                  <span className="text-stone-400">{formatDateTime(m.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600">
                  {m.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-dashed border-stone-200 pt-3">
        <Textarea
          value={draft}
          maxLength={MESSAGE_CONTENT_MAX}
          rows={3}
          placeholder="问一句，或把已知的信息补充给后面的人…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-stone-400">公开可见 · 同社区居民都能读到</span>
          <Button size="sm" onClick={submit} disabled={sending || !draft.trim()}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
