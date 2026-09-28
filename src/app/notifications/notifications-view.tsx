'use client';

import { Bell, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { SessionGate } from '@/components/features/session-gate';
import { Button } from '@/components/ui/button';
import { ContractGap } from '@/components/ui/contract-gap';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RowSkeleton } from '@/components/ui/skeleton';
import { Stagger } from '@/components/ui/stagger';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useItemSummaries, useMyClaims } from '@/lib/queries';
import type { ClaimDto } from '@/shared/types';

interface Note {
  key: string;
  at: string | null;
  text: string;
  href: string;
}

/**
 * 从申请的状态与时间戳重建通知流。
 *
 * 后端确实在写 Notification 表（claims/service.ts 五处 + 种子四条），
 * 但没有读取接口，所以这里能给的只有「状态机什么时候动过」，
 * 而不是真正的收件箱：没有已读状态、也没有站内信正文。这一点在页面下方标出来。
 */
function buildNotes(
  claims: ClaimDto[],
  perspective: 'applied' | 'received',
  nameOf: (itemId: string) => string,
): Note[] {
  const notes: Note[] = [];

  for (const claim of claims) {
    const item = nameOf(claim.itemId);
    const href = `/items/${claim.itemId}`;
    const who = claim.applicant.nickname;

    if (perspective === 'applied') {
      notes.push({ key: `${claim.id}-c`, at: claim.createdAt, text: `你申请了「${item}」`, href });
      if (claim.acceptedAt) {
        notes.push({
          key: `${claim.id}-a`,
          at: claim.acceptedAt,
          text: `对方接受了你对「${item}」的申请，联系方式已开放`,
          href,
        });
      }
      if (claim.completedAt) {
        notes.push({
          key: `${claim.id}-d`,
          at: claim.completedAt,
          text: `「${item}」已确认交接完成`,
          href,
        });
      }
      if (claim.status === 'REJECTED') {
        notes.push({
          key: `${claim.id}-r`,
          at: null,
          text: `对方婉拒了你对「${item}」的申请（接口未给出拒绝时间）`,
          href,
        });
      }
      continue;
    }

    notes.push({
      key: `${claim.id}-c`,
      at: claim.createdAt,
      text: `${who} 申请了你的「${item}」`,
      href,
    });
    if (claim.acceptedAt) {
      notes.push({
        key: `${claim.id}-a`,
        at: claim.acceptedAt,
        text: `你接受了 ${who} 对「${item}」的申请`,
        href,
      });
    }
    if (claim.completedAt) {
      notes.push({
        key: `${claim.id}-d`,
        at: claim.completedAt,
        text: `你与 ${who} 的「${item}」已交接完成`,
        href,
      });
    }
  }

  return notes;
}

function Notifications() {
  const applied = useMyClaims('applied');
  const received = useMyClaims('received');

  const claims = React.useMemo(
    () => [...(applied.data ?? []), ...(received.data ?? [])],
    [applied.data, received.data],
  );
  const ids = React.useMemo(() => claims.map((claim) => claim.itemId), [claims]);
  const { summaries } = useItemSummaries(ids);
  const nameOf = (itemId: string) => summaries.get(itemId)?.name ?? itemId;

  const notes = React.useMemo(() => {
    const all = [
      ...buildNotes(applied.data ?? [], 'applied', nameOf),
      ...buildNotes(received.data ?? [], 'received', nameOf),
    ];
    return all.sort((a, b) => {
      if (a.at === null && b.at === null) return 0;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });
    // nameOf 依赖 summaries，不需要额外列进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied.data, received.data, summaries]);

  const isLoading = applied.isPending || received.isPending;

  return (
    <>
      <PageHeader
        eyebrow="NOTIFICATIONS · 通知"
        title="最近发生什么"
        desc="由申请的状态与时间戳重建：谁申请了、什么时候接受、什么时候交接完成。"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void applied.refetch();
              void received.refetch();
            }}
          >
            <RefreshCw size={13} aria-hidden />
            刷新
          </Button>
        }
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          eyebrow="TIMELINE"
          title="动态"
          action={<span className="tnum text-[11.5px] text-ink-3">{notes.length} 条</span>}
          className="border-b py-3"
        />

        {isLoading && (
          <div className="space-y-2.5 p-5">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

        {!isLoading && notes.length === 0 && (
          <EmptyState
            icon={Bell}
            title="还没有动态"
            desc="发出或收到第一条申请之后，这里会出现时间线。"
          />
        )}

        {notes.length > 0 && (
          <Stagger className="divide-y divide-line">
            {notes.map((note) => (
              <div
                key={note.key}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3"
              >
                <span className="tnum w-[13.5rem] shrink-0 text-[11.5px] text-ink-3">
                  {note.at ? `${formatDateTime(note.at)} · ${formatRelative(note.at)}` : '时间未知'}
                </span>
                <span className="min-w-0 flex-1 text-[13px] text-ink">{note.text}</span>
                <Link
                  href={note.href}
                  className="shrink-0 text-[12px] font-medium text-accent underline-offset-4 hover:underline"
                >
                  查看物品
                </Link>
              </div>
            ))}
          </Stagger>
        )}
      </Panel>

      <ContractGap
        className="mt-5"
        section="§6"
        endpoint="GET /api/me/notifications"
        existsInstead="通知行后端已经在写，但没有读取接口，所以这里只有从 claims 重建的时间线：没有已读标记，也没有真正的站内信正文。"
      />
    </>
  );
}

export function NotificationsView() {
  return (
    <SessionGate>
      <Notifications />
    </SessionGate>
  );
}
