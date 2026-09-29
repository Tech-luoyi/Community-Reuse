/**
 * SSE 表示层单测（**离线**，不碰网络与 DB）。
 *
 * 覆盖 docs/api-contract.md §8.2 的四条硬规则里可在本层验证的部分：
 *   2. `result` 事件**恰好一个、且是最后一个**；
 *   3. R1：降级时 `result` 仍是完整契约体，**不出现半截 JSON**；
 *   以及「过程事件不承载契约」——事件数量/顺序变化不影响 `result`。
 */
import { describe, expect, it } from 'vitest';

import type { GraphEvent } from '@/server/ai/graph';
import { parseSse, sseResponse, wantsStream } from '@/server/ai/sse';

async function readAll(response: Response): Promise<string> {
  const buffer = new Uint8Array();
  const chunks: Uint8Array[] = [buffer];
  const reader = response.body?.getReader();
  if (reader !== undefined) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

function ev(state: string, attempt = 1): GraphEvent {
  return { state, attempt, latencyMs: 12 };
}

describe('ai.sse：协商', () => {
  it('只有 Accept 含 text/event-stream 才走流式', () => {
    expect(wantsStream(new Request('http://x', { headers: { accept: 'text/event-stream' } }))).toBe(
      true,
    );
    expect(wantsStream(new Request('http://x', { headers: { accept: 'application/json' } }))).toBe(
      false,
    );
    expect(wantsStream(new Request('http://x'))).toBe(false);
    expect(
      wantsStream(new Request('http://x', { headers: { accept: 'TEXT/EVENT-STREAM,*/*' } })),
    ).toBe(true);
  });
});

describe('ai.sse：事件帧', () => {
  it('result 恰好一个且是最后一个，data 与非流式契约体同构', async () => {
    const payload = { degraded: false, source: 'llm', mode: 'PRICED' };
    const response = sseResponse<{ degraded: boolean }>(async (onEvent) => {
      onEvent(ev('CACHE_LOOKUP'));
      onEvent(ev('CALL_MODEL'));
      return payload;
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSse(await readAll(response));
    const results = events.filter((e) => e.event === 'result');
    expect(results).toHaveLength(1);
    expect(events.at(-1)?.event).toBe('result');
    expect(results[0]?.data).toEqual({ data: payload });
    expect(
      events.filter((e) => e.event === 'state').map((e) => (e.data as GraphEvent).state),
    ).toEqual(['CACHE_LOOKUP', 'CALL_MODEL']);
  });

  it('R1：降级结果同样以完整 result 收尾，不出现半截 JSON', async () => {
    const degraded = { degraded: true, source: 'rule', usedTools: false, toolCalls: 0 };
    const events = parseSse(
      await readAll(
        sseResponse(async (onEvent) => {
          onEvent(ev('CALL_MODEL', 1));
          onEvent({ ...ev('FALLBACK', 1), ok: true });
          onEvent(ev('DONE', 1));
          return degraded;
        }),
      ),
    );
    expect(events.at(-1)).toEqual({ event: 'result', data: { data: degraded } });
    // 过程事件里没有任何契约字段
    for (const e of events.filter((x) => x.event === 'state')) {
      expect(e.data).not.toHaveProperty('degraded');
    }
  });

  it('服务层破了 R1（意外抛异常）时也要收尾，绝不让流半开挂住', async () => {
    const events = parseSse(
      await readAll(
        sseResponse<string>(async (onEvent) => {
          onEvent(ev('BUILD_PROMPT'));
          throw new Error('服务层不该抛这个');
        }),
      ),
    );
    expect(events.at(-1)?.event).toBe('error');
    expect((events.at(-1)?.data as { error: { message: string } }).error.message).toContain(
      '服务层不该抛这个',
    );
    expect(events.some((e) => e.event === 'result')).toBe(false);
  });

  it('同步 resolve 也不会漏掉 result（先挂 promise 再进写循环）', async () => {
    const events = parseSse(await readAll(sseResponse(async () => 'immediate')));
    expect(events.at(-1)).toEqual({ event: 'result', data: { data: 'immediate' } });
  });

  it('慢生产者：事件按到达顺序写出，不被合并或丢弃', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const events = parseSse(
      await readAll(
        sseResponse<string>(async (onEvent) => {
          onEvent(ev('CACHE_LOOKUP'));
          await sleep(15);
          onEvent(ev('CALL_MODEL'));
          await sleep(15);
          onEvent(ev('TOOL_EXEC'));
          await sleep(5);
          return 'slow';
        }),
      ),
    );
    expect(
      events.filter((e) => e.event === 'state').map((e) => (e.data as GraphEvent).state),
    ).toEqual(['CACHE_LOOKUP', 'CALL_MODEL', 'TOOL_EXEC']);
    expect(events.at(-1)).toEqual({ event: 'result', data: { data: 'slow' } });
  });
});

describe('ai.sse：parseSse 自身', () => {
  it('忽略尾部空块，能解析空 data', () => {
    const parsed = parseSse('event: state\ndata: {"a":1}\n\nevent: result\ndata: {}\n\n');
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ event: 'result', data: {} });
  });
});
