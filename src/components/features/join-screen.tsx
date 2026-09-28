'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Inset, Panel, PanelHeader } from '@/components/ui/panel';
import { isApiError, toMessage } from '@/lib/api';
import { applyApiFieldErrors } from '@/lib/form';
import { useJoin } from '@/lib/mutations';
import { JoinRequestSchema, type JoinRequest } from '@/shared/schemas';

/**
 * 加入社区：邀请码 + 昵称两个字段，成功后由 mutation 跳到集市。
 *
 * 后端只有 `POST /api/auth/join`（GUEST，新建 User 并签发 Cookie），没有「列出可加入的社区」
 * 这类接口，所以这里只能让人自己填邀请码 —— 下面把种子里的两个码如实标成演示信息，
 * 而不是编一个社区列表出来。
 */
export function JoinScreen() {
  const join = useJoin();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<JoinRequest>({
    resolver: zodResolver(JoinRequestSchema),
    defaultValues: { inviteCode: '', nickname: '' },
  });

  const onSubmit = handleSubmit((values) => {
    join.mutate(values, {
      onError: (error) => {
        if (applyApiFieldErrors(setError, error)) return;
        if (isApiError(error) && error.code === 'NOT_FOUND') {
          setError('inviteCode', { message: '邀请码不存在，请向邻居确认后再试' });
          return;
        }
        toast.error(toMessage(error, '加入失败，请稍后重试'));
      },
    });
  });

  return (
    <div className="mx-auto w-full max-w-[460px] pt-6">
      <Panel>
        <PanelHeader
          eyebrow="JOIN · 加入社区"
          title="加入你的小区"
          desc="邻里流转按社区隔离：一个邀请码对应一个小区，加入后用同一个身份在楼里流转闲置。"
        />
        <form className="space-y-4 p-5" onSubmit={onSubmit} noValidate>
          <Field
            label="邀请码"
            htmlFor="inviteCode"
            required
            error={errors.inviteCode?.message}
            hint="向本小区的邻居或群主要，形如 LINFENG-2026"
          >
            <Input
              id="inviteCode"
              autoComplete="organization"
              placeholder="LINFENG-2026"
              className="tnum uppercase"
              invalid={Boolean(errors.inviteCode)}
              {...register('inviteCode')}
            />
          </Field>

          <Field
            label="昵称"
            htmlFor="nickname"
            required
            error={errors.nickname?.message}
            counter="最多 30 字"
            hint="楼号 + 称呼最好用，对手方看到的就是它"
          >
            <Input
              id="nickname"
              autoComplete="nickname"
              placeholder="3栋-老王"
              invalid={Boolean(errors.nickname)}
              {...register('nickname')}
            />
          </Field>

          <Button
            variant="primary"
            size="md"
            type="submit"
            className="w-full"
            disabled={join.isPending}
          >
            <UserPlus size={15} aria-hidden />
            {join.isPending ? '加入中…' : '加入社区'}
          </Button>
        </form>
      </Panel>

      <Inset className="mt-4">
        <div className="label-xs">演示环境</div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
          种子数据里有两个小区：
          <span className="tnum text-ink"> LINFENG-2026</span>（临风小区）、
          <span className="tnum text-ink"> YUNQI-2026</span>（云栖公寓）。 这个列表是照{' '}
          <span className="tnum">prisma/seed-data.ts</span> 写的说明文字， 接口本身不提供社区列表。
        </p>
      </Inset>
    </div>
  );
}
