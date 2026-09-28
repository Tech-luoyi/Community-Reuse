'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Check, Inbox, PackageX, RefreshCw, ShieldCheck, Undo2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { SessionGate } from '@/components/features/session-gate';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContractGap } from '@/components/ui/contract-gap';
import { CoverPlate } from '@/components/ui/cover-plate';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Inset, MetaList, Panel, PanelHeader } from '@/components/ui/panel';
import { RowSkeleton, Skeleton } from '@/components/ui/skeleton';
import { isApiError, toMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { applyApiFieldErrors } from '@/lib/form';
import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_TONE,
  FRESHNESS_TONE,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_TONE,
  TRADE_TYPE_LABEL,
  formatDateTime,
  formatPrice,
  formatRelative,
} from '@/lib/format';
import { useArchiveItem, useClaimAction, useCreateClaim } from '@/lib/mutations';
import { useItemClaims, useItemDetail, useMyClaims } from '@/lib/queries';
import { CLAIM_LOCATION_MAX, CLAIM_MESSAGE_MAX } from '@/shared/schemas';
import type { ClaimDto, ItemDetailDto } from '@/shared/types';

/**
 * 申请表单。契约只收 ISO 时间串，而 `<input type="datetime-local">` 给的是
 * 不带时区的本地串，所以本地字段单独校验，提交前才换算成 ISO。
 */
const ClaimFormSchema = z.object({
  message: z.string().trim().max(CLAIM_MESSAGE_MAX).optional(),
  preferredLocation: z.string().trim().max(CLAIM_LOCATION_MAX).optional(),
  preferredAtLocal: z.string().optional(),
});
type ClaimFormValues = z.infer<typeof ClaimFormSchema>;

function toIsoOrUndefined(local: string | undefined): string | undefined {
  if (!local) return undefined;
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function ClaimForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const createClaim = useCreateClaim(itemId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    resolver: zodResolver(ClaimFormSchema),
    defaultValues: { message: '', preferredLocation: '', preferredAtLocal: '' },
  });

  const onSubmit = handleSubmit((values) => {
    createClaim.mutate(
      {
        message: values.message?.trim() || undefined,
        preferredLocation: values.preferredLocation?.trim() || undefined,
        preferredAt: toIsoOrUndefined(values.preferredAtLocal),
      },
      {
        onSuccess: () => {
          toast.success('申请已发出，等对方回应');
          onDone();
        },
        onError: (error) => {
          if (applyApiFieldErrors(setError, error)) return;
          if (isApiError(error) && error.isConflict) {
            toast.error('这件已经被别人领走了');
            onDone();
            return;
          }
          toast.error(toMessage(error, '申请没发出去，请稍后重试'));
        },
      },
    );
  });

  return (
    <Panel>
      <PanelHeader eyebrow="CLAIM · 申请领取" title="申请这一件" className="border-b py-3" />
      <form className="space-y-3.5 p-4" onSubmit={onSubmit} noValidate>
        <Field
          label="给邻居留句话"
          htmlFor="claim-message"
          counter={`${CLAIM_MESSAGE_MAX} 字以内`}
          error={errors.message?.message}
        >
          <Textarea
            id="claim-message"
            placeholder="什么时候方便来拿、能不能自提…"
            className="min-h-[72px]"
            {...register('message')}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="期望时间" htmlFor="claim-at" error={errors.preferredAtLocal?.message}>
            <Input id="claim-at" type="datetime-local" {...register('preferredAtLocal')} />
          </Field>
          <Field label="交接地点" htmlFor="claim-loc" error={errors.preferredLocation?.message}>
            <Input id="claim-loc" placeholder="3栋楼下" {...register('preferredLocation')} />
          </Field>
        </div>

        <Button variant="accent" type="submit" className="w-full" disabled={createClaim.isPending}>
          {createClaim.isPending ? '发送中…' : '提交申请'}
        </Button>
      </form>
    </Panel>
  );
}

/** 物主视角：某件物品上的申请，按状态给出可做的转移。 */
function OwnerClaimList({ itemId }: { itemId: string }) {
  const claims = useItemClaims(itemId, true);
  const accept = useClaimAction('accept');
  const reject = useClaimAction('reject');

  const act = (
    mutation: typeof accept,
    claim: ClaimDto,
    ok: string,
    conflict: string,
    refetch: () => Promise<unknown>,
  ) =>
    mutation.mutate(
      { id: claim.id, itemId: claim.itemId },
      {
        onSuccess: () => toast.success(ok),
        onError: (error) => {
          if (isApiError(error) && error.isConflict) toast.error(conflict);
          else toast.error(toMessage(error, '操作没成功，请稍后重试'));
          void refetch();
        },
      },
    );

  if (claims.isPending) {
    return (
      <div className="space-y-2.5 p-4">
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  }

  if (claims.isError) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="申请列表没读到"
        desc={claims.error instanceof Error ? claims.error.message : '请求失败。'}
        action={
          <Button variant="secondary" onClick={() => void claims.refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  if ((claims.data?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="还没有人申请"
        desc="有邻居申请时会出现在这里，你可以直接接受或婉拒。"
        className="py-10"
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {claims.data?.map((claim) => (
        <li key={claim.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink">
                  {claim.applicant.nickname}
                </span>
                <StatusChip tone={CLAIM_STATUS_TONE[claim.status]}>
                  {CLAIM_STATUS_LABEL[claim.status]}
                </StatusChip>
              </div>
              {claim.message && (
                <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-2">
                  「{claim.message}」
                </p>
              )}
              <p className="tnum mt-1 text-[11px] text-ink-3">
                {formatDateTime(claim.createdAt)}
                {claim.preferredLocation ? ` · ${claim.preferredLocation}` : ''}
              </p>
            </div>

            {claim.status === 'PENDING' && (
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="accent"
                  disabled={accept.isPending}
                  onClick={() =>
                    act(accept, claim, '已接受，联系方式已开放给对方', '这件已经定给别人了', () =>
                      claims.refetch(),
                    )
                  }
                >
                  <Check size={13} aria-hidden />
                  接受
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={reject.isPending}
                  onClick={() =>
                    act(reject, claim, '已婉拒', '状态已变，请刷新后重试', () => claims.refetch())
                  }
                >
                  婉拒
                </Button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 申请人视角：我自己在这件物品上的那条申请，以及它当前允许的动作。 */
function MyClaimPanel({ mine }: { mine: ClaimDto }) {
  const cancel = useClaimAction('cancel');
  const complete = useClaimAction('complete');

  const run = (mutation: typeof cancel, ok: string) =>
    mutation.mutate(
      { id: mine.id, itemId: mine.itemId },
      {
        onSuccess: () => toast.success(ok),
        onError: (error) => toast.error(toMessage(error, '操作没成功，请稍后重试')),
      },
    );

  return (
    <Panel>
      <PanelHeader
        eyebrow="MY CLAIM · 我的申请"
        title="你在这件物品上的申请"
        action={
          <StatusChip tone={CLAIM_STATUS_TONE[mine.status]}>
            {CLAIM_STATUS_LABEL[mine.status]}
          </StatusChip>
        }
        className="border-b py-3"
      />
      <div className="space-y-3 p-4">
        <MetaList
          rows={[
            { label: '提交于', value: formatDateTime(mine.createdAt) },
            ...(mine.acceptedAt
              ? [{ label: '接受于', value: formatDateTime(mine.acceptedAt) }]
              : []),
            ...(mine.preferredLocation
              ? [{ label: '约定地点', value: mine.preferredLocation }]
              : []),
          ]}
        />

        {mine.status === 'ACCEPTED' && (
          <Inset>
            <div className="label-xs">对方联系方式</div>
            <div className="tnum mt-1 text-[13px] font-medium break-words text-ink">
              {mine.contactText ?? '对方未填写联系方式'}
            </div>
          </Inset>
        )}

        <div className="flex flex-wrap gap-2">
          {mine.status === 'PENDING' && (
            <Button size="sm" variant="secondary" onClick={() => run(cancel, '已撤回申请')}>
              <Undo2 size={13} aria-hidden />
              撤回申请
            </Button>
          )}
          {mine.status === 'ACCEPTED' && (
            <Button size="sm" variant="primary" onClick={() => run(complete, '已标记为交接完成')}>
              <Check size={13} aria-hidden />
              确认拿到
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function OwnerActions({ item }: { item: ItemDetailDto }) {
  const archive = useArchiveItem();
  const [confirming, setConfirming] = React.useState(false);

  // 契约里没有「取消归档」，所以归档是不可逆动作：先就地二次确认，不弹系统对话框
  const armed = confirming && item.status === 'ACTIVE';

  return (
    <Panel>
      <PanelHeader eyebrow="OWNER · 我的物品" title="这一件是你发布的" className="border-b py-3" />
      <div className="space-y-3 p-4">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          申请会列在下面。归档之后这件就从集市下架，
          <span className="text-ink">这一步在现有接口里不可撤销</span>。
        </p>

        {item.status === 'ACTIVE' && (
          <Button
            variant={armed ? 'danger' : 'secondary'}
            size="sm"
            className="w-full"
            disabled={archive.isPending}
            onClick={() => {
              if (!armed) {
                setConfirming(true);
                setTimeout(() => setConfirming(false), 4000);
                return;
              }
              archive.mutate(item.id, {
                onSuccess: () => {
                  setConfirming(false);
                  toast.success('已归档下架');
                },
                onError: (error) => toast.error(toMessage(error, '归档没成功')),
              });
            }}
          >
            <PackageX size={13} aria-hidden />
            {archive.isPending ? '归档中…' : armed ? '再点一次确认归档' : '归档下架'}
          </Button>
        )}
      </div>
    </Panel>
  );
}

function Detail({ item }: { item: ItemDetailDto }) {
  const detail = useItemDetail(item.id);
  const viewer = item.viewer;
  const priceText = formatPrice(item.price, item.tradeType);
  const tradeText = TRADE_TYPE_LABEL[item.tradeType];

  // 已经有一条活着的申请时不再摆申请表单：同一件事给两个入口，第二个必然失败
  const myClaims = useMyClaims('applied');
  const liveClaim =
    myClaims.data?.find(
      (claim) =>
        claim.itemId === item.id && (claim.status === 'PENDING' || claim.status === 'ACCEPTED'),
    ) ?? null;

  return (
    <>
      <Link
        href="/"
        className={cn(
          'inline-flex items-center gap-1.5 text-[12.5px] text-ink-2',
          'ease-out transition-colors duration-[170ms] hover:text-ink',
        )}
      >
        <ArrowLeft size={14} aria-hidden />
        返回集市
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
        <div className="min-w-0">
          <PageHeader
            eyebrow={item.category ?? '未分类'}
            title={item.name}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={FRESHNESS_TONE[item.freshness.code]}>{item.freshness.label}</Badge>
                {item.status !== 'ACTIVE' && (
                  <StatusChip tone={ITEM_STATUS_TONE[item.status]}>
                    {ITEM_STATUS_LABEL[item.status]}
                  </StatusChip>
                )}
              </div>
            }
          />

          <div className="aspect-[4/3] w-full max-w-[560px] overflow-hidden rounded-lg border border-line">
            <CoverPlate
              src={item.coverUrl}
              name={item.name}
              category={item.category}
              size="lg"
              className="rounded-none"
            />
          </div>

          <Panel className="mt-5">
            <PanelHeader
              eyebrow="DESCRIPTION"
              title="描述"
              className="border-b py-3"
              action={
                <span className="tnum text-[11px] text-ink-3">{item.description.length} 字</span>
              }
            />
            <p className="px-5 py-4 text-[13px] leading-[1.72] whitespace-pre-line text-ink-2">
              {item.description}
            </p>
          </Panel>

          <div className="mt-5 space-y-3">
            <ContractGap
              section="§5"
              endpoint="POST /api/items/:id/favorite"
              existsInstead="收藏开关还没有接口，所以这里不放一颗会骗人的心形按钮。收藏页目前只能诚实说明缺口。"
            />
            <ContractGap
              section="§6"
              endpoint="GET /api/items/:id/messages"
              existsInstead="详情页没有留言板。沟通走申请里的留言与接受后开放的联系方式。"
            />
          </div>
        </div>

        <aside className="space-y-4">
          <Panel>
            <div className="px-5 py-4">
              <div className="flex items-baseline gap-2">
                <span className="tnum text-[26px] leading-none font-semibold tracking-[-0.024em] text-ink">
                  {priceText}
                </span>
                {priceText !== tradeText && (
                  <span className="text-[12px] text-ink-3">{tradeText}</span>
                )}
              </div>
              <MetaList
                className="mt-4"
                rows={[
                  { label: '物主', value: item.owner.nickname },
                  { label: '分类', value: item.category ?? '未分类' },
                  { label: '发布', value: formatRelative(item.publishedAt) },
                  { label: '已收到申请', value: `${item.claimCount} 条` },
                  { label: '编号', value: <span className="tnum">{item.id}</span> },
                ]}
              />
            </div>
            {viewer.isOwner && (
              <div className="hairline-t flex items-center gap-1.5 px-5 py-2.5 text-[12px] text-ink-3">
                <ShieldCheck size={13} aria-hidden />
                这是你发布的物品
              </div>
            )}
          </Panel>

          {liveClaim ? (
            <MyClaimPanel mine={liveClaim} />
          ) : (
            viewer.canClaim && <ClaimForm itemId={item.id} onDone={() => void detail.refetch()} />
          )}

          {viewer.isOwner && <OwnerActions item={item} />}
          {viewer.isOwner && (
            <Panel className="overflow-hidden">
              <PanelHeader
                eyebrow="INCOMING CLAIMS"
                title="收到的申请"
                action={<span className="tnum text-[11.5px] text-ink-3">{item.claimCount} 条</span>}
                className="border-b py-3"
              />
              <OwnerClaimList itemId={item.id} />
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

function ItemDetailPane({ id }: { id: string }) {
  const detail = useItemDetail(id);

  if (detail.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-4 h-8 w-64" />
        <Skeleton className="mt-4 aspect-[4/3] w-full max-w-[560px] rounded-lg" />
      </div>
    );
  }

  if (detail.isError) {
    const notFound = isApiError(detail.error) && detail.error.code === 'NOT_FOUND';
    return (
      <Panel className="mt-6">
        <EmptyState
          icon={notFound ? PackageX : RefreshCw}
          title={notFound ? '这件物品不在了' : '这件物品没读到'}
          desc={
            notFound
              ? '链接可能来自已删除或已下架的物品，也可能属于另一个小区。'
              : detail.error instanceof Error
                ? detail.error.message
                : '请求失败。'
          }
          action={
            notFound ? (
              <Link href="/" className="text-[12.5px] font-medium text-accent hover:underline">
                返回集市
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                <RefreshCw size={14} aria-hidden />
                重试
              </Button>
            )
          }
        />
      </Panel>
    );
  }

  return <Detail item={detail.data} />;
}

export function ItemView({ id }: { id: string }) {
  return (
    <SessionGate>
      <ItemDetailPane id={id} />
    </SessionGate>
  );
}
