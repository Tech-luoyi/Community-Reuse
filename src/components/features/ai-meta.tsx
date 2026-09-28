'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type { AiMeta } from '@/shared/schemas';

const SOURCE_LABEL: Record<AiMeta['source'], string> = {
  llm: '模型直出',
  rule: '规则兜底',
  cache: '缓存命中',
};

/**
 * AI 结果的出处必须写在脸上。
 *
 * 没配模型 Key 时后端走本地规则兜底并带 `degraded: true`，这里就照实说「规则兜底」，
 * 而不是把一条 if-else 的结果包装成「AI 智能建议」——那是这个项目最不能干的事。
 */
export function AiMetaLine({ meta, className }: { meta: AiMeta; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]', className)}>
      <Badge tone={meta.degraded ? 'warning' : 'accent'}>{SOURCE_LABEL[meta.source]}</Badge>
      <span className="text-ink-3">
        {meta.degraded ? '未配置模型 Key，结果由本地规则给出' : '由模型生成，仅供参考'}
      </span>
      {meta.usedTools && <span className="tnum text-ink-3">工具调用 {meta.toolCalls} 次</span>}
    </div>
  );
}
