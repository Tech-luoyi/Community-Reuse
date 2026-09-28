'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';

import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api';
import { useLogout, useSwitchCommunity } from '@/lib/mutations';
import { useSession } from '@/lib/queries';

/**
 * 侧栏底部的身份槽：当前社区 + 昵称 + 切换 + 退出。
 *
 * 它是外壳里唯一读会话的地方，而且是客户端岛 —— 服务端布局仍然不碰 Cookie，
 * 所以数据没到之前只有这一小块是骨架，外壳不位移。
 *
 * 切换列表只能显示 `communityId`：契约的 `memberships` 只有 ID，
 * 其他小区的名称没有任何接口能拿到，宁可不显示也不猜。
 */
export function IdentitySlot() {
  const session = useSession();
  const logout = useLogout();
  const switchCommunity = useSwitchCommunity();
  const data = session.data;

  return (
    <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
      <div className="label-xs">当前社区</div>

      {session.isPending && (
        <div className="mt-1.5 space-y-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      )}

      {!session.isPending && isApiError(session.error) && session.error.isUnauthenticated && (
        <>
          <div className="mt-1 text-[12.5px] text-ink-3">尚未加入社区</div>
          <Link
            href="/join"
            className="mt-1 inline-block text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
          >
            用邀请码加入
          </Link>
        </>
      )}

      {!session.isPending &&
        !data &&
        !(isApiError(session.error) && session.error.isUnauthenticated) && (
          <div className="mt-1 text-[12.5px] text-ink-3">会话读取失败</div>
        )}

      {data && (
        <>
          <div className="mt-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-ink">
                {data.currentCommunity.name}
              </div>
              <div className="tnum mt-0.5 truncate text-[11px] text-ink-3">
                {data.user.nickname} · {data.currentCommunity.id}
              </div>
            </div>
            <IconButton
              label="退出登录"
              icon={LogOut}
              size="icon-sm"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            />
          </div>

          {data.memberships.length > 1 && (
            <select
              aria-label="切换社区"
              title="契约的 memberships 只给 communityId，其他小区的名称无接口可查，所以只能按 ID 列"
              className="tnum mt-2 h-6 w-full rounded-xs border border-line bg-surface px-1 text-[11px] text-ink-2"
              value={data.currentCommunity.id}
              disabled={switchCommunity.isPending}
              onChange={(event) => switchCommunity.mutate(event.target.value)}
            >
              {data.memberships.map((membership) => (
                <option key={membership.communityId} value={membership.communityId}>
                  {membership.communityId === data.currentCommunity.id
                    ? `当前 · ${data.currentCommunity.name}`
                    : `切到 ${membership.communityId}`}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}
