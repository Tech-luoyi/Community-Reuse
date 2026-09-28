'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, LogOut, Package } from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { SessionGate } from '@/components/features/session-gate';
import { ItemRow } from '@/components/features/item-row';
import { Button } from '@/components/ui/button';
import { ContractGap } from '@/components/ui/contract-gap';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Inset, MetaList, Panel, PanelHeader } from '@/components/ui/panel';
import { RowSkeleton } from '@/components/ui/skeleton';
import { Stagger } from '@/components/ui/stagger';
import { toMessage } from '@/lib/api';
import { applyApiFieldErrors } from '@/lib/form';
import { useLogout, usePatchMe } from '@/lib/mutations';
import { useSession, useStatusScan } from '@/lib/queries';
import { CONTACT_TEXT_MAX, NICKNAME_MAX } from '@/shared/schemas';
import type { ItemDto, ItemStatus, MeResponseData } from '@/shared/types';

/** 契约的 `PatchMeRequest` 两个字段都可选，但资料页提交时昵称必须非空。 */
const ProfileSchema = z.object({
  nickname: z.string().trim().min(1, '昵称不能为空').max(NICKNAME_MAX),
  contactText: z.string().trim().max(CONTACT_TEXT_MAX).optional(),
});
type ProfileValues = z.infer<typeof ProfileSchema>;

/** 一页 100 条是契约硬上限；超出时只翻第一页并在下方明说口径。 */
const SCAN_PAGE_SIZE = 100;

function ProfileForm() {
  const session = useSession();
  const me = session.data;

  // 会话没到之前不挂载表单：useForm 的 defaultValues 只在首帧取一次，
  // 先挂空表单再灌值会让「没有改动」的判断失真。
  if (!me) {
    return (
      <Panel className="p-5">
        <RowSkeleton />
        <RowSkeleton />
      </Panel>
    );
  }

  return <ProfileFields me={me} />;
}

function ProfileFields({ me }: { me: MeResponseData }) {
  const patchMe = usePatchMe();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: { nickname: me.user.nickname, contactText: me.user.contactText ?? '' },
  });

  const onSubmit = handleSubmit((values) => {
    patchMe.mutate(
      {
        nickname: values.nickname.trim(),
        contactText: values.contactText?.trim() ?? '',
      },
      {
        onSuccess: () => toast.success('资料已保存'),
        onError: (error) => {
          if (applyApiFieldErrors(setError, error)) return;
          toast.error(toMessage(error, '保存失败，请稍后重试'));
        },
      },
    );
  });

  return (
    <Panel>
      <PanelHeader
        eyebrow="PROFILE · 资料"
        title="昵称与联系方式"
        desc="联系方式只在交接达成后开放给对手方，其他人看不到。留空则对方看到「对方未填写联系方式」。"
      />
      <form className="space-y-4 p-5" onSubmit={onSubmit} noValidate>
        <Field
          label="昵称"
          htmlFor="me-nickname"
          required
          counter={`${NICKNAME_MAX} 字以内`}
          error={errors.nickname?.message}
        >
          <Input id="me-nickname" {...register('nickname')} />
        </Field>

        <Field
          label="联系方式"
          htmlFor="me-contact"
          counter={`${CONTACT_TEXT_MAX} 字以内`}
          error={errors.contactText?.message}
          hint="微信号、手机号都行，原样给对方"
        >
          <Textarea id="me-contact" className="min-h-[64px]" {...register('contactText')} />
        </Field>

        <div className="flex items-center gap-2">
          <Button variant="primary" type="submit" disabled={patchMe.isPending || !isDirty}>
            <Check size={14} aria-hidden />
            {patchMe.isPending ? '保存中…' : '保存'}
          </Button>
          {!isDirty && <span className="text-[12px] text-ink-3">没有改动</span>}
        </div>
      </form>
    </Panel>
  );
}

function Section({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: ItemDto[];
  emptyHint: string;
}) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        eyebrow="MY ITEMS"
        title={title}
        action={<span className="tnum text-[11.5px] text-ink-3">{items.length} 件</span>}
        className="border-b py-3"
      />
      {items.length === 0 ? (
        <EmptyState icon={Package} title={emptyHint} className="py-10" />
      ) : (
        <Stagger className="divide-y divide-line">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </Stagger>
      )}
    </Panel>
  );
}

const MY_GROUPS: { status: ItemStatus; title: string; emptyHint: string }[] = [
  { status: 'ACTIVE', title: '在架', emptyHint: '没有在架的物品' },
  { status: 'RESERVED', title: '已预约', emptyHint: '没有被预约的物品' },
  { status: 'ARCHIVED', title: '已归档', emptyHint: '还没有归档过物品' },
];

function MyItems() {
  const session = useSession();
  const myId = session.data?.user.id;
  // 与看板共用同一套扫描口径，避免两处各自翻页导致数字对不上
  const scan = useStatusScan();

  if (scan.isPending) {
    return (
      <Panel className="p-5">
        <RowSkeleton />
        <RowSkeleton />
      </Panel>
    );
  }

  if (scan.isError) {
    return (
      <Panel>
        <EmptyState
          icon={Package}
          title="我的发布没读到"
          desc="契约没有 /api/me/items，这一页是靠翻物品列表现算的，列表请求失败时这里就没有内容。"
          action={
            <Button variant="secondary" onClick={scan.refetch}>
              重试
            </Button>
          }
        />
      </Panel>
    );
  }

  const mine = scan.items.filter((item) => item.owner.id === myId);

  return (
    <div className="space-y-4">
      {MY_GROUPS.map((group) => (
        <Section
          key={group.status}
          title={group.title}
          items={mine.filter((item) => item.status === group.status)}
          emptyHint={group.emptyHint}
        />
      ))}

      {scan.truncated && (
        <Inset>
          <div className="label-xs">口径说明</div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
            某个状态的社区物品超过 <span className="tnum">{SCAN_PAGE_SIZE}</span> 件时只翻了第一页，
            这里可能不含你更早的那几件。
          </p>
        </Inset>
      )}
    </div>
  );
}

function Account() {
  const session = useSession();
  const logout = useLogout();
  const me = session.data;
  if (!me) return null;

  return (
    <Panel>
      <PanelHeader eyebrow="ACCOUNT · 账号" title="当前身份" className="border-b py-3" />
      <div className="space-y-4 p-5">
        <MetaList
          rows={[
            { label: '昵称', value: me.user.nickname },
            { label: '用户编号', value: <span className="tnum">{me.user.id}</span> },
            { label: '当前社区', value: `${me.currentCommunity.name} · ${me.currentCommunity.id}` },
            { label: '成员身份', value: `${me.memberships.length} 个社区` },
          ]}
        />
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <LogOut size={13} aria-hidden />
          {logout.isPending ? '退出中…' : '退出登录'}
        </Button>
      </div>
    </Panel>
  );
}

function MePage() {
  return (
    <>
      <PageHeader
        eyebrow="ME · 我的"
        title="资料与我的发布"
        desc="一个身份对应该小区：昵称与联系方式是邻居在交接时唯一能看到的信息。"
        actions={
          <Link
            href="/"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-line-strong hover:bg-sunken"
          >
            返回集市
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-5">
          <ProfileForm />
          <MyItems />
        </div>

        <aside className="space-y-4">
          <Account />
          <ContractGap
            section="§2"
            endpoint="GET /api/me/items"
            existsInstead="我的发布是翻 GET /api/items 的三种状态各一页，再按 owner.id 过滤出来的；社区物品很多时可能不全，上方会标口径。"
          />
        </aside>
      </div>
    </>
  );
}

export function MeView() {
  return (
    <SessionGate>
      <MePage />
    </SessionGate>
  );
}
