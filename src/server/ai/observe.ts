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

/** 观测日志的固定前缀，便于在混排输出里 grep。 */
const LOG_PREFIX = '[ai.graph]';

/**
 * 把一次图执行的事件序列攒成一行摘要日志。
 *
 * 逐事件打日志会在一次请求里刷十几行、把 dev 输出冲垮；这里按请求聚合，
 * 结束时打一行含**完整状态路径**的摘要，既能定位卡在哪一态，又保持可读。
 */
export function createObserver(requestId: string): {
  onEvent: (event: GraphEvent) => void;
  summary: () => string;
} {
  const events: GraphEvent[] = [];
  return {
    onEvent: (event) => {
      events.push(event);
    },
    summary: () => {
      const path = events.map((e) => `${e.state}#${e.attempt}${e.ok === false ? '!' : ''}`);
      const total = events.at(-1)?.latencyMs ?? 0;
      const failed = events.filter((e) => e.ok === false);
      return JSON.stringify({
        msg: `${LOG_PREFIX} ${requestId}`,
        path: path.join('→'),
        states: events.length,
        totalMs: total,
        toolMode: events.find((e) => e.toolMode)?.toolMode ?? 'none',
        failures: failed.map((f) => ({ state: f.state, reason: f.reason })),
      });
    },
  };
}

/** 打一行摘要。失败路径用 warn，正常用 log。 */
export function flushObserver(observer: ReturnType<typeof createObserver>): void {
  const line = observer.summary();
  if (line.includes('"failures":[{')) {
    console.warn(line);
  } else {
    console.log(line);
  }
}
