/**
 * `Asia/Shanghai` 自然月界（`src/server/stats/month.ts`）——纯函数、零依赖、可单测。
 *
 * 事实源：docs/api-contract.md §7 ——「DB 存 UTC；聚合按 Asia/Shanghai 自然月，
 * `monthRange` 显式回传，便于前端核对」。
 *
 * 为什么手写 +08:00 而不用 `Intl`/`luxon`：
 *   - 该区**无夏令时**（1991 年起不再实行），偏移恒为 `+08:00` ⇒ 固定偏移即正确，
 *     不必为一个月界计算引入时区库；
 *   - 固定偏移让 `monthRange` 的**回传字符串**与**参与比较的 UTC 瞬间**出自同一次计算，
 *     结构上杜绝「展示的月界」与「实际聚合的月界」两套算法漂移（契约要求二者逐字一致）。
 */

/** 看板聚合时区（契约字面量）。 */
export const SHANGHAI_TIMEZONE = 'Asia/Shanghai';

/** `Asia/Shanghai` 相对 UTC 的固定偏移（分钟）。 */
const SHANGHAI_OFFSET_MINUTES = 480;

/** 月界：`[start, end)` 为参与 SQL 比较的 UTC 瞬间；`*Iso` 为契约回传字面量。 */
export interface MonthWindow {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isoWithOffset(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}T00:00:00+08:00`;
}

/** 某瞬间所在 `Asia/Shanghai` 自然月的 `[月初, 下月初)`。 */
export function shanghaiMonthWindow(instant: Date): MonthWindow {
  const shifted = new Date(instant.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000);
  const year = shifted.getUTCFullYear();
  // 1 基月份：`isoWithOffset` 的入参口径与回传字符串一致，避免 0/1 基混用（历史 bug 源）。
  const monthNo = shifted.getUTCMonth() + 1;
  const nextYear = monthNo === 12 ? year + 1 : year;
  const nextMonthNo = monthNo === 12 ? 1 : monthNo + 1;
  const month = monthNo - 1;

  // 本地月初（墙上时间 1 日 00:00）→ UTC 瞬间：减去偏移。
  const startUtcMs = Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MINUTES * 60_000;
  const endUtcMs = Date.UTC(year, month + 1, 1) - SHANGHAI_OFFSET_MINUTES * 60_000;

  return {
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
    startIso: isoWithOffset(year, monthNo, 1),
    endIso: isoWithOffset(nextYear, nextMonthNo, 1),
  };
}
