/**
 * SSE 过程事件流式（`src/server/ai/sse.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.6.6、docs/api-contract.md §8.2。
 *
 * **为什么只流过程事件、不流结果体**：若把模型的 JSON 逐 token 吐给客户端，那么后续
 * `REPAIR` 失败或 deadline 耗尽时，已发出的片段收不回来，而 R1 要求此时返回**完整的规则
 * 结果**——契约就自相矛盾了。所以：
 *   - `event: state`  过程事件，**不承载契约**，客户端必须能在完全忽略它时正常工作；
 *   - `event: result` 恰好一个、且是最后一个，`data` 与非流式响应**逐字节同构**。
 *
 * **为什么不上 WebSocket / EventSource**：复用同一 POST 端点与同一套鉴权 / 限流 / 租户守卫，
 * 不新增路由、不破 D8；`EventSource` 不支持 POST + JSON body，故前端用
 * `fetch` + `ReadableStream`（可带 `credentials:'include'`）。
 */
import type { GraphEvent } from './graph';

/** 判断请求是否要求流式表示。 */
export function wantsStream(request: Request): boolean {
  return (request.headers.get('accept') ?? '').toLowerCase().includes('text/event-stream');
}

/** SSE 响应头。`no-transform` 防中间层压缩改写；`x-accel-buffering` 关 nginx 侧缓冲。 */
function sseHeaders(): HeadersInit {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
}

/** 编码一条 SSE 事件。`data` 恒为单行 JSON，故不需要多行 `data:` 前缀处理。 */
function frame(event: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * 事件总线：图在任意时刻 push，消费端 `wait()` 到下一个事件或执行结束。
 *
 * 单独抽出来是为了让「何时该唤醒写循环」这件事只有一处实现——
 * 直接拿 Promise 手搓很容易写出竞态（我第一版就写错了）。
 */
class EventBus {
  private readonly queue: GraphEvent[] = [];
  private wakeFn: (() => void) | null = null;

  public push = (event: GraphEvent): void => {
    this.queue.push(event);
    this.wake();
  };

  public drain(): GraphEvent[] {
    if (this.queue.length === 0) {
      return [];
    }
    return this.queue.splice(0, this.queue.length);
  }

  public hasPending(): boolean {
    return this.queue.length > 0;
  }

  /** 唤醒等待者（执行结束时也调用，避免写循环挂死）。 */
  public wake(): void {
    const fn = this.wakeFn;
    this.wakeFn = null;
    fn?.();
  }

  /** 等到有新事件或被唤醒。 */
  public async wait(): Promise<void> {
    if (this.queue.length > 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.wakeFn = () => {
        this.wakeFn = null;
        resolve();
      };
    });
  }
}

/**
 * 把「一次图执行」包装成 SSE 响应。
 *
 * @param produce 收到 `onEvent` 后开始执行；resolve 的值写进唯一的 `result` 事件。
 *   服务层**必须自己保证失败时返回降级结果而不抛异常**（R1）；这里对意外抛出仍做兜底
 *   编码（`event: error`），绝不让客户端挂在半开的流上。
 */
export function sseResponse<T>(
  produce: (onEvent: (event: GraphEvent) => void) => Promise<T>,
): Response {
  const bus = new EventBus();
  let outcome: { ok: true; data: T } | { ok: false; message: string } | null = null;

  // 先挂上 promise 再进循环：否则 produce 同步 resolve 时永远等不到唤醒。
  const running = produce(bus.push);
  void running.then(
    (data) => {
      outcome = { ok: true, data };
      bus.wake();
    },
    (error: unknown) => {
      outcome = {
        ok: false,
        message: error instanceof Error ? error.message : 'unknown',
      };
      bus.wake();
    },
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (;;) {
        for (const event of bus.drain()) {
          controller.enqueue(frame('state', event));
        }
        if (outcome !== null) {
          break;
        }
        await bus.wait();
      }
      // 收尾前再冲一次，拿住「执行结束与最后一次 drain 之间」到达的事件。
      for (const event of bus.drain()) {
        controller.enqueue(frame('state', event));
      }
      if (outcome !== null && outcome.ok) {
        controller.enqueue(frame('result', { data: outcome.data }));
      } else {
        controller.enqueue(
          frame('error', {
            error: {
              code: 'INTERNAL',
              message: outcome === null ? 'unknown' : outcome.message,
            },
          }),
        );
      }
      controller.close();
    },
    cancel() {
      bus.wake();
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}

/** 解析一段 SSE 文本为 `{event, data}` 列表（测试与前端共用同一份语义）。 */
export function parseSse(raw: string): { event: string; data: unknown }[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event: '));
      const dataLine = lines.find((line) => line.startsWith('data: '));
      return {
        event: (eventLine ?? 'event: message').slice(7),
        data: dataLine === undefined ? null : (JSON.parse(dataLine.slice(6)) as unknown),
      };
    });
}
