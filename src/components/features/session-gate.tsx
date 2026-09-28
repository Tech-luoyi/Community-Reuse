'use client';

import { RefreshCw, ServerCrash } from 'lucide-react';
import * as React from 'react';

import { JoinScreen } from '@/components/features/join-screen';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { RowSkeleton, Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api';
import { useSession } from '@/lib/queries';

/**
 * 客户端会话门禁。
 *
 * 三种状态各自诚实：拉取中给骨架（外壳不动）、未登录直接给加入表单（不是报错页）、
 * 其他失败（网络 / 库挂了 / 契约漂移）明说失败原因并提供重试，绝不渲染假数据。
 *
 * 放在客户端而不是 middleware：`verifySessionToken` 依赖 node:crypto，Edge 跑不了；
 * 而只判断 Cookie 存不存在属于安全剧场 —— 真正的鉴权始终在服务层。
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const session = useSession();

  if (session.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-7 w-52" />
        <div className="mt-7 space-y-2.5">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </div>
    );
  }

  const error = session.error;

  if (isApiError(error) && error.isUnauthenticated) {
    return <JoinScreen />;
  }

  if (error) {
    return (
      <Panel className="mt-6">
        <EmptyState
          icon={ServerCrash}
          title="读不到你的会话"
          desc={
            <>
              {error instanceof Error && error.message.length > 0
                ? error.message
                : '请求失败，可能是网络或后端不可用。'}
              <br />
              外壳还在，但内容需要登录后才能取，所以这里什么都不显示 —— 而不是先画一份假列表。
            </>
          }
          action={
            <Button variant="secondary" onClick={() => void session.refetch()}>
              <RefreshCw size={14} aria-hidden />
              重试
            </Button>
          }
        />
      </Panel>
    );
  }

  return <>{children}</>;
}
