'use client';

import { ArrowLeftRight, Check, Inbox, Undo2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { ClaimRow } from '@/components/features/claim-row';
import { SessionGate } from '@/components/features/session-gate';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Segmented } from '@/components/ui/segmented';
import { RowSkeleton } from '@/components/ui/skeleton';
import { Stagger } from '@/components/ui/stagger';
import { isApiError, toMessage } from '@/lib/api';
import { useClaimAction, type ClaimAction } from '@/lib/mutations';
import { useItemSummaries, useMyClaims } from '@/lib/queries';
import type { ClaimDto, ClaimStatus } from '@/shared/types';

type Perspective = 'applied' | 'received';

const TABS: { value: Perspective; label: string }[] = [
  { value: 'applied', label: '我发出的' },
  { value: 'received', label: '收到的' },
];

/** 状态机在当前视角下允许的动作；不在表里的状态一律只读。 */
const ACTIONS: Record<Perspective, Partial<Record<ClaimStatus, ClaimAction[]>>> = {
  applied: { PENDING: ['cancel'], ACCEPTED: ['complete'] },
  received: { PENDING: ['accept', 'reject'], ACCEPTED: ['complete'] },
};

const ACTION_LABEL: Record<ClaimAction, string> = {
  accept: '接受',
  reject: '婉拒',
  complete: '确认拿到',
  cancel: '撤回申请',
};

const DONE_TOAST: Partial<Record<ClaimAction, string>> = {
  accept: '已接受，联系方式已开放给对方',
  reject: '已婉拒这条申请',
  complete: '已标记为交接完成',
  cancel: '已撤回申请',
};

function ClaimActions({ claim, action }: { claim: ClaimDto; action: ClaimAction }) {
  const mutation = useClaimAction(action);

  return (
    <Button
      size="sm"
      variant={action === 'accept' ? 'accent' : action === 'complete' ? 'primary' : 'secondary'}
      disabled={mutation.isPending}
      onClick={() =>
        mutation.mutate(
          { id: claim.id, itemId: claim.itemId },
          {
            onSuccess: () => toast.success(DONE_TOAST[action] ?? '已更新'),
            onError: (error) =>
              toast.error(
                isApiError(error) && error.isConflict
                  ? '状态已经变了，列表已重新拉取'
                  : toMessage(error, '操作没成功，请稍后重试'),
              ),
          },
        )
      }
    >
      {action === 'accept' || action === 'complete' ? (
        <Check size={13} aria-hidden />
      ) : action === 'cancel' ? (
        <Undo2 size={13} aria-hidden />
      ) : null}
      {mutation.isPending ? '处理中…' : ACTION_LABEL[action]}
    </Button>
  );
}

function Requests() {
  const [perspective, setPerspective] = React.useState<Perspective>('applied');
  const claims = useMyClaims(perspective);

  const rows = React.useMemo(
    () =>
      [...(claims.data ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [claims.data],
  );
  const ids = React.useMemo(() => rows.map((claim) => claim.itemId), [rows]);
  const { summaries } = useItemSummaries(ids);

  return (
    <>
      <PageHeader
        eyebrow="REQUESTS · 我的流转"
        title="我的申请"
        desc="一条申请就是一台状态机：状态、时间线、以及这一步允许做的事。联系方式只在对方接受之后才揭示。"
        actions={
          <span className="tnum rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
            {claims.data ? `${claims.data.length} 条` : '读取中'}
          </span>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="申请视角"
          value={perspective}
          onChange={setPerspective}
          options={TABS}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void claims.refetch()}
          disabled={claims.isFetching}
        >
          {claims.isFetching ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <Panel className="overflow-hidden">
        {claims.isPending && (
          <div className="space-y-2.5 p-5">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

        {claims.isError && (
          <EmptyState
            icon={Inbox}
            title="申请列表没读到"
            desc={claims.error instanceof Error ? claims.error.message : '请求失败。'}
            action={
              <Button variant="secondary" onClick={() => void claims.refetch()}>
                重试
              </Button>
            }
          />
        )}

        {!claims.isPending && !claims.isError && rows.length === 0 && (
          <EmptyState
            icon={ArrowLeftRight}
            title={perspective === 'applied' ? '还没有发出过申请' : '还没有收到申请'}
            desc={
              perspective === 'applied'
                ? '在集市里看中哪件，点进去留句话就行。'
                : '有人申请你发布的物品时，会出现在这里等你处理。'
            }
            action={
              perspective === 'applied' ? (
                <Link
                  href="/"
                  className="text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
                >
                  去集市看看
                </Link>
              ) : undefined
            }
          />
        )}

        {rows.length > 0 && (
          <Stagger className="divide-y divide-line">
            {rows.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                variant={perspective}
                item={summaries.get(claim.itemId) ?? null}
                actions={(ACTIONS[perspective][claim.status] ?? []).map((action) => (
                  <ClaimActions key={action} claim={claim} action={action} />
                ))}
              />
            ))}
          </Stagger>
        )}
      </Panel>
    </>
  );
}

export function RequestsView() {
  return (
    <SessionGate>
      <Requests />
    </SessionGate>
  );
}
