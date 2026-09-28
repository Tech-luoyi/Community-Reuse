import * as React from 'react';

import { CoverPlate } from '@/components/ui/cover-plate';
import { StatusChip } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, formatDateTime } from '@/lib/format';
import type { ClaimDto, ClaimStatus } from '@/shared/types';

/**
 * 一行就是一个状态机控制台：状态 + 等宽时间线 + 该状态下允许的动作。
 *
 * `ClaimDto` 只带 `itemId`，不带物品名与封面（契约 §4），所以物品信息由调用方
 * 用已缓存的列表数据解析后传入；解析不到就退回显示等宽 itemId，不猜、不编。
 *
 * `contactText` 只在 ACCEPTED / COMPLETED 揭示 —— 这是契约 §4 的对手方可见规则；
 * 为 null 时明说「对方未填写」，而不是留一个空槽让人以为没加载完。
 */
const CONTACT_VISIBLE: ClaimStatus[] = ['ACCEPTED', 'COMPLETED'];

export interface ClaimItemSummary {
  name: string;
  category?: string | null;
  coverUrl?: string | null;
}

function TimelineCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={cn('tnum text-[11.5px]', value ? 'text-ink-2' : 'text-ink-3/70')}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

export function ClaimRow({
  claim,
  item,
  variant,
  actions,
  className,
}: {
  claim: ClaimDto;
  item?: ClaimItemSummary | null;
  /** `received` = 我名下物品收到的申请，需要显示申请人；`applied` 反之。 */
  variant: 'applied' | 'received';
  actions?: React.ReactNode;
  className?: string;
}) {
  const showContact = CONTACT_VISIBLE.includes(claim.status);

  return (
    <article className={cn('px-5 py-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          {item && (
            <CoverPlate
              src={item.coverUrl}
              name={item.name}
              category={item.category}
              size="sm"
              className="size-11 rounded-md"
            />
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={CLAIM_STATUS_TONE[claim.status]}>
                {CLAIM_STATUS_LABEL[claim.status]}
              </StatusChip>
              <span className="tnum truncate text-[10.5px] text-ink-3">{claim.id}</span>
            </div>

            <h3 className="mt-1.5 truncate text-[14.5px] leading-snug font-semibold tracking-[-0.008em] text-ink">
              {item?.name ?? claim.itemId}
            </h3>

            {variant === 'received' && (
              <p className="mt-0.5 truncate text-[12px] text-ink-3">
                申请人 {claim.applicant.nickname}
              </p>
            )}

            {claim.message && (
              <p className="mt-1.5 line-clamp-2 max-w-[54ch] text-[12.5px] leading-relaxed text-ink-2">
                「{claim.message}」
              </p>
            )}
          </div>
        </div>

        {actions && <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{actions}</div>}
      </div>

      <dl className="tnum mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2.5">
        <TimelineCell label="提交" value={formatDateTime(claim.createdAt)} />
        <TimelineCell
          label="接受"
          value={claim.acceptedAt ? formatDateTime(claim.acceptedAt) : null}
        />
        <TimelineCell
          label="完成"
          value={claim.completedAt ? formatDateTime(claim.completedAt) : null}
        />
        {claim.preferredLocation && <TimelineCell label="地点" value={claim.preferredLocation} />}
        {claim.preferredAt && (
          <TimelineCell label="期望" value={formatDateTime(claim.preferredAt)} />
        )}
      </dl>

      {/* 联系方式用高度揭示而不是条件渲染：点「接受」后这一块自己长出来，
          视线不需要重新找行；关掉时同理收回，不留下跳变。 */}
      <div className="reveal" data-open={showContact} aria-hidden={!showContact}>
        <div>
          <div className="mt-2.5 rounded-md border border-line bg-sunken px-3 py-2">
            <div className="label-xs">联系方式</div>
            {claim.contactText ? (
              <div className="tnum mt-1 text-[13px] font-medium break-words text-ink">
                {claim.contactText}
              </div>
            ) : (
              <div className="mt-1 text-[12.5px] text-ink-3">对方未填写联系方式</div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
