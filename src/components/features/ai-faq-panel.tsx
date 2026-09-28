'use client';

import { Sparkles } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { AiMetaLine } from '@/components/features/ai-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Inset, Panel, PanelHeader } from '@/components/ui/panel';
import { isApiError, toMessage } from '@/lib/api';
import { useAiFaq } from '@/lib/mutations';

/**
 * 物主侧的交接问答：帮物主预想邻居会问什么，答案只是回复草稿。
 *
 * 后端 `POST /api/ai/faq` 没有校验调用者是不是物主（契约 §7 的已知缺口），
 * 所以这个面板只在前端确认 `viewer.isOwner` 之后才挂载 —— 藏起来不是修复，
 * 但至少不会由前端主动把缺口用出去。
 */
export function AiFaqPanel({ itemId }: { itemId: string }) {
  const faq = useAiFaq();
  const [question, setQuestion] = React.useState('');

  const ask = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    faq.mutate(
      { itemId, question: trimmed },
      {
        onError: (error) =>
          toast.error(
            isApiError(error) && error.isRateLimited
              ? 'AI 能力每分钟 10 次，稍等一下再问'
              : toMessage(error, '生成失败，请稍后重试'),
          ),
      },
    );
  };

  return (
    <Panel>
      <PanelHeader
        eyebrow="AI FAQ · 交接问答"
        title="预想邻居会问什么"
        desc="答案只作为你回复时的草稿参考，不会替你向邻居承诺任何事。"
        className="border-b py-3"
      />
      <form className="space-y-3 p-4" onSubmit={ask}>
        <div className="flex gap-2">
          <Input
            aria-label="想问自己的问题"
            placeholder="比如：能便宜点吗？"
            maxLength={200}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button
            variant="accent"
            type="submit"
            disabled={faq.isPending || question.trim().length === 0}
          >
            <Sparkles size={14} aria-hidden />
            {faq.isPending ? '生成中…' : '草拟'}
          </Button>
        </div>

        {faq.data && (
          <Inset className="anim-rise">
            <p className="text-[13px] leading-relaxed text-ink">{faq.data.answer}</p>
            <div className="mt-2.5 flex items-center gap-3">
              <AiMetaLine meta={faq.data} className="flex-1" />
              <span className="tnum shrink-0 text-[11px] text-ink-3">
                置信度 {(faq.data.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </Inset>
        )}
      </form>
    </Panel>
  );
}
