/**
 * 并发**转移**的终态一致性不变量（真连库路由测试）。
 *
 * 目的：固化「并发的两个状态转移，无论以何种顺序交错，DB 最终只会落在**状态机允许的一致组合**
 * 上，绝不出现撕裂态（torn state）」这一不变量。
 *
 * ── 为什么**不能**用状态码计数（如 `expect(okCount).toBe(1)`）来断言 ────────────────────────
 * 两个转移都先在事务内对**物品行**加 `SELECT … FOR UPDATE`（锁序恒为 Item → ClaimRequest），
 * 因此二者**串行**，但**谁先拿到锁是不确定的**；于是同一组并发存在**多种合法交错**，
 * 落到 200 的个数也随之不同：
 *
 *   accept × cancel（同一条 PENDING 申请）：
 *     交错①「cancel 先」：cancel `PENDING→CANCELED`（物品不动，仍 ACTIVE）；随后 accept 读到
 *        claim 已是 CANCELED（≠PENDING）→ 409 回滚。⇒ 200 个数 = 1。
 *     交错②「accept 先」：accept `PENDING→ACCEPTED` + 物品 `ACTIVE→RESERVED`；随后 cancel 读到
 *        claim 已是 ACCEPTED → `ACCEPTED→CANCELED` **且释放物品**（`RESERVED→ACTIVE`、`reservedAt=null`）。
 *        ⇒ 200 个数 = 2。
 *   两种交错**都合法**，200 个数 ∈ {1,2} ⇒ 断言 `okCount === 1` 是**错的**（会 flaky）。
 *   （这正是先前「P3 探针」误报的根因：把「恰好一个 200」错当成不变量。）
 *
 *   complete × cancel（同一条 ACCEPTED 申请）：
 *     交错①「complete 先」：complete `ACCEPTED→COMPLETED`、物品 `RESERVED→ARCHIVED`；随后 cancel 读到
 *        claim 已是 COMPLETED（∉{PENDING,ACCEPTED}）→ 409 回滚。⇒ 终态 (COMPLETED, ARCHIVED)。
 *     交错②「cancel 先」：cancel `ACCEPTED→CANCELED` 且释放物品 → `ACTIVE`/`reservedAt=null`；随后
 *        complete 读到 CANCELED（≠ACCEPTED）→ 409 回滚。⇒ 终态 (CANCELED, ACTIVE, reservedAt=null)。
 *
 * 因此断言的是**终态组合**（`claim.status` × `item.status` × `reservedAt` 是否为空）必须属于下列集合，
 * 而不是任何「状态码计数」：
 *
 *   accept × cancel   ∈ { (CANCELED, ACTIVE, reservedAt=NULL),
 *                         (ACCEPTED, RESERVED, reservedAt≠NULL) }
 *   complete × cancel ∈ { (COMPLETED, ARCHIVED),
 *                         (CANCELED, ACTIVE, reservedAt=NULL) }
 *
 * 实测（20 轮诊断，未提交）：
 *   · accept × cancel 的 200 个数分布覆盖 {1,2} 两种交错（如 `1,2,1,…,2,1,2,2`）；但因本轮
 *     cancel 对 ACCEPTED 恒可成功，实际终态**恒收敛到 CANCELED 分支**——`(ACCEPTED, RESERVED)`
 *     在此配对下并不出现。
 *   · complete × cancel 两种终态**均真实出现**：`(COMPLETED, ARCHIVED)` 与 `(CANCELED, ACTIVE, NULL)`。
 *
 * 说明：`(ACCEPTED, RESERVED, reservedAt≠NULL)` 是状态机**允许的一致终态**，此处仍**显式枚举**它，
 * 是因为不变量的正确表述是「终态属于状态机允许的一致集合，绝不出现撕裂组合」；硬编码成单一取值会在
 * 语义（如「ACCEPTED 不可取消」）日后变更时静默失效。真正的红线：**绝不**出现
 * `(CANCELED, RESERVED)` / `(ACCEPTED, ACTIVE)` 这类 claim 与 item **互相矛盾**的撕裂组合。
 *
 * 每轮用**全新**的 item + claim 起步（0 条历史），重复 ≥5 轮以覆盖不同交错。
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as acceptPOST } from '@/app/api/claims/[id]/accept/route';
import { POST as cancelPOST } from '@/app/api/claims/[id]/cancel/route';
import { POST as completePOST } from '@/app/api/claims/[id]/complete/route';
import { prisma } from '@/server/db';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  insertClaim,
  insertItem,
  mintSessionToken,
} from './helpers/db';
import { makeRequest } from './helpers/http';

/** 每类并发跑多少轮（team-lead 要求 ≥5）。 */
const ROUNDS = 6;

/** 终态快照：claim 状态 × item 状态 × 物品是否已释放（reservedAt === null）。 */
interface TransitionTerminal {
  claimStatus: string;
  itemStatus: string;
  reservedAtNull: boolean;
}

/**
 * accept × cancel 的**合法一致终态**集合。
 * 二者皆由 PENDING 出发；见文件头注释的两种合法交错。
 */
const ACCEPT_CANCEL_TERMINALS: readonly TransitionTerminal[] = [
  { claimStatus: 'CANCELED', itemStatus: 'ACTIVE', reservedAtNull: true },
  { claimStatus: 'ACCEPTED', itemStatus: 'RESERVED', reservedAtNull: false },
];

/**
 * complete × cancel 的**合法一致终态**集合。
 * 二者皆由 ACCEPTED 出发；见文件头注释的两种合法交错。
 * （complete 不改 `reservedAt`，故 COMPLETED 分支下它仍为非空。）
 */
const COMPLETE_CANCEL_TERMINALS: readonly TransitionTerminal[] = [
  { claimStatus: 'COMPLETED', itemStatus: 'ARCHIVED', reservedAtNull: false },
  { claimStatus: 'CANCELED', itemStatus: 'ACTIVE', reservedAtNull: true },
];

/**
 * 读取终态快照。
 * 时间字段经 **Prisma**（而非 `pg`）读取，规避 `timestamp` 无时区列在 pg 驱动下的 +8h 解析偏差
 * （见 db-clock 回归的既定结论）；这里只需「是否为空」，走 Prisma 更稳妥。
 */
async function readTerminal(claimId: string, itemId: string): Promise<TransitionTerminal> {
  const claim = await prisma.claimRequest.findUnique({
    where: { id: claimId },
    select: { status: true },
  });
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { status: true, reservedAt: true },
  });
  if (claim === null || item === null) {
    throw new Error(`终态读取失败：claim=${claimId} item=${itemId}`);
  }
  return {
    claimStatus: claim.status,
    itemStatus: item.status,
    reservedAtNull: item.reservedAt === null,
  };
}

/** 断言一组并发响应「无 5xx」且「至少一个 200」。 */
function expectNoServerErrorAndAtLeastOneOk(statuses: number[]): void {
  expect(statuses.some((s) => s >= 500)).toBe(false);
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
}

describe('并发转移的终态一致性不变量（真连库）', () => {
  const scope = 'claims-transition';
  let fx: TenantFixtures;
  let ownerToken: string;
  let applicantToken: string;

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    applicantToken = mintSessionToken(fx.dualId, fx.communityAId);
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // accept × cancel（同一条 PENDING 申请）
  // ---------------------------------------------------------------------------
  for (let round = 1; round <= ROUNDS; round += 1) {
    it(`accept × cancel 并发（第 ${round} 轮）→ 终态恒为一致组合，无 5xx，至少一个 200`, async () => {
      const itemId = await insertItem(scope, {
        key: `ac-item-${round}`,
        communityId: fx.communityAId,
        ownerId: fx.ownerId,
        name: `accept-cancel 物品${round}`,
        status: 'ACTIVE',
      });
      const claimId = await insertClaim(scope, {
        key: `ac-claim-${round}`,
        itemId,
        applicantId: fx.dualId,
        status: 'PENDING',
      });

      const [acceptRes, cancelRes] = await Promise.all([
        acceptPOST(makeRequest('POST', `/api/claims/${claimId}/accept`, { token: ownerToken }), {
          params: Promise.resolve({ id: claimId }),
        }),
        cancelPOST(
          makeRequest('POST', `/api/claims/${claimId}/cancel`, { token: applicantToken }),
          {
            params: Promise.resolve({ id: claimId }),
          },
        ),
      ]);

      expectNoServerErrorAndAtLeastOneOk([acceptRes.status, cancelRes.status]);

      const terminal = await readTerminal(claimId, itemId);
      expect(ACCEPT_CANCEL_TERMINALS).toContainEqual(terminal);
    });
  }

  // ---------------------------------------------------------------------------
  // complete × cancel（同一条 ACCEPTED 申请）
  // ---------------------------------------------------------------------------
  for (let round = 1; round <= ROUNDS; round += 1) {
    it(`complete × cancel 并发（第 ${round} 轮）→ 终态恒为一致组合，无 5xx`, async () => {
      const itemId = await insertItem(scope, {
        key: `cc-item-${round}`,
        communityId: fx.communityAId,
        ownerId: fx.ownerId,
        name: `complete-cancel 物品${round}`,
        status: 'ACTIVE',
      });
      const claimId = await insertClaim(scope, {
        key: `cc-claim-${round}`,
        itemId,
        applicantId: fx.dualId,
        status: 'PENDING',
      });

      // 先用真实 accept 走一遍，得到 **真实一致** 的 ACCEPTED 起步态
      // （claim=ACCEPTED、item=RESERVED、reservedAt≠NULL），避免手工构造出与状态机不符的夹具。
      const accepted = await acceptPOST(
        makeRequest('POST', `/api/claims/${claimId}/accept`, { token: ownerToken }),
        { params: Promise.resolve({ id: claimId }) },
      );
      expect(accepted.status).toBe(200);
      expect(await readTerminal(claimId, itemId)).toEqual({
        claimStatus: 'ACCEPTED',
        itemStatus: 'RESERVED',
        reservedAtNull: false,
      });

      const [completeRes, cancelRes] = await Promise.all([
        completePOST(
          makeRequest('POST', `/api/claims/${claimId}/complete`, { token: ownerToken }),
          {
            params: Promise.resolve({ id: claimId }),
          },
        ),
        cancelPOST(
          makeRequest('POST', `/api/claims/${claimId}/cancel`, { token: applicantToken }),
          {
            params: Promise.resolve({ id: claimId }),
          },
        ),
      ]);

      expect([completeRes.status, cancelRes.status].some((s) => s >= 500)).toBe(false);

      const terminal = await readTerminal(claimId, itemId);
      expect(COMPLETE_CANCEL_TERMINALS).toContainEqual(terminal);
    });
  }
});
