/**
 * 图运行时的结构化观测（`src/server/ai/observe.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.6.3「每节点进入/退出输出结构化日志」。
 *
 * **为什么单独成模块**：`GraphEvent` 只是图吐出的数据，落到哪里、什么级别、采样与否
 * 属于运维策略。分开放，服务层就只需要把 `onEvent` 接上，不必内嵌日志格式。
 *
 * `latencyMs` 与 `toolMode` **不进 HTTP 契约**（§6.1 明确），只在这里落地——
 * 答辩时用日志证明「模型自主调工具」与「服务端预取」两条路都真实查了库。
 */
import type { GraphEvent } from './graph';
import { log } from '@/server/logger';

/** 观测日志的固定前缀，便于在混排输出里 grep。 */
const LOG_PREFIX = '[ai.graph]';

/**
 * 把一次图执行的事件序列攒成一行摘要。
 *
 * 逐事件打日志会在一次请求里刷十几行、把 dev 输出冲垮；这里按请求聚合，
 * 结束时打一行含**完整状态路径**的摘要，既能定位卡在哪一态，又保持可读。
 */
export function createObserver(requestId: string): {
  onEvent: (event: GraphEvent) => void;
  /** 诊断用：只读拷贝，供调用方自行断言 / 上报。 */
  events: GraphEvent[];
  /** 本次观测的请求标签（与 `http.access` 的 requestId 不同源，仅用于人读）。 */
  requestId: string;
} {
  const events: GraphEvent[] = [];
  return {
    onEvent: (event) => {
      events.push(event);
    },
    events,
    requestId,
  };
}

/** 打一行摘要。失败路径用 warn，正常用 info。 */
export function flushObserver(observer: ReturnType<typeof createObserver>): void {
  const { events } = observer;
  const failed = events.filter((e) => e.ok === false);
  const line = {
    msg: `${LOG_PREFIX} ${observer.requestId}`,
    path: events.map((e) => `${e.state}#${e.attempt}${e.ok === false ? '!' : ''}`).join('→'),
    states: events.length,
    // DONE 事件的 latencyMs 是全图总耗时（见 graph.persist）。
    totalMs: events.at(-1)?.latencyMs ?? 0,
    toolMode: events.find((e) => e.toolMode)?.toolMode ?? 'none',
    failures: failed.map((f) => ({ state: f.state, reason: f.reason })),
  };
  // 按**结构**判定成败，不做 JSON 子串匹配：字符串嗅探在改一次格式后就会静默失效。
  if (failed.length > 0) {
    log.warn(LOG_PREFIX, line);
  } else {
    log.info(LOG_PREFIX, line);
  }
}
