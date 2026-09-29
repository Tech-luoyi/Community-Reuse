/**
 * 时间预算（`src/server/ai/budget.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.6.4。
 *
 * **为什么单独成模块**：INC-1 把 `TOTAL_DEADLINE_MS` 定义在 `gateway.ts` 里却**全仓零引用**——
 * 一个从不生效的"全局硬闸"比没有更糟，因为它会让评审和后续维护者都以为存在兜底。
 * 本模块让 deadline 成为图运行时**每一步都必须查询**的显式输入。
 *
 * **实测依据（2026-09-29，当前供应商 `step-3.7-flash`）**：
 *   - 无 tools 单轮：5.4–8.8s（p50 ≈ 6.7s）
 *   - **带 tools 单轮：1.7 / 15.1 / 16.2 / 20.7s** —— 方差极大，4 次中 3 次 > 15s
 *   - 上一家供应商（`agnes-3.0-flash`）p100 曾达 20.7s
 * 结论：单轮上限必须显著高于「典型值」，否则 agent 主路径会被自己的超时掐死。
 *
 * **预算分配策略**：不用固定每轮上限硬撞 deadline，而是
 * `本轮上限 = min(ROUND_CAP_MS, 剩余额度 / 尚需步数)`——
 * 剩余时间越少、分配越紧，保证「最后一步一定跑得完」，也让终止性可证。
 */

/** 环境变量读正整数；缺失或非法则取默认值。 */
function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * 单轮模型往返的**上限**（不是目标值）。可用 `LLM_TIMEOUT_MS` 覆盖。
 * 仅供本模块的 `roundTimeoutMs` 使用，不对外暴露。
 */
const MODEL_ROUND_CAP_MS = positiveIntFromEnv(process.env.LLM_TIMEOUT_MS, 22_000);

/** 全局硬闸。可用 `LLM_DEADLINE_MS` 覆盖；**部署到远端时应设为宿主上限的 80%**。 */
export const TOTAL_DEADLINE_MS = positiveIntFromEnv(process.env.LLM_DEADLINE_MS, 60_000);

/**
 * 工具轮次上限。
 *
 * 取 2 而非设计初稿的 3：带 tools 单轮实测可达 20.7s，3 轮在 60s 闸下**必然**被截断，
 * 与其让第 3 轮跑到一半被掐（白花一次钱、还拿不到结果），不如把额度让给 REPAIR。
 * 该值可经 `LLM_MAX_TOOL_ROUNDS` 上调（换更快供应商时）。
 */
export const MAX_TOOL_ROUNDS = positiveIntFromEnv(process.env.LLM_MAX_TOOL_ROUNDS, 2);

/** REPAIR 轮次数上界（§6.6.1：恰好 1 次）。 */
export const MAX_REPAIR_ROUNDS = 1;

/** 进入 REPAIR 的最低时间门槛：剩余不足一个单轮下限就不进，直接降级。 */
const REPAIR_ENTRY_FLOOR_MS = positiveIntFromEnv(process.env.LLM_REPAIR_FLOOR_MS, 4_000);

/** 一次图执行的预算快照。 */
export interface Budget {
  readonly startedAt: number;
  readonly deadlineAt: number;
}

/** 开图时拍一次快照。 */
export function newBudget(now: number = Date.now()): Budget {
  return { startedAt: now, deadlineAt: now + TOTAL_DEADLINE_MS };
}

/** 距全局硬闸还剩多少毫秒（可为负，表示已耗尽）。仅本模块内部使用。 */
function remainingMs(budget: Budget, now: number = Date.now()): number {
  return budget.deadlineAt - now;
}

/**
 * 计算本轮应使用的超时。
 *
 * @param stepsRemaining 含本轮在内、预计还要跑的模型步数（用于摊薄剩余额度）
 * @returns 毫秒数；`<= 0` 表示额度已尽，调用方**必须**直接走降级而非再调模型
 */
export function roundTimeoutMs(
  budget: Budget,
  stepsRemaining: number,
  now: number = Date.now(),
): number {
  const left = remainingMs(budget, now);
  if (left <= 0) {
    return 0;
  }
  const share = Math.floor(left / Math.max(1, stepsRemaining));
  return Math.min(MODEL_ROUND_CAP_MS, share);
}

/** 是否还有足够余量进入 REPAIR（避免跑一半被 deadline 截断的不可归因失败）。 */
export function canEnterRepair(budget: Budget, now: number = Date.now()): boolean {
  return remainingMs(budget, now) >= REPAIR_ENTRY_FLOOR_MS;
}
