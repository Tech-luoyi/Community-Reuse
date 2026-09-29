/**
 * 结构化日志与请求关联 ID 的单测（纯离线）。
 *
 * 钉死三条性质：
 *   1. **每条日志是一个 JSON 对象**，且字段恒含 `{level, msg, time}`。
 *   2. **敏感字段被脱敏**（密钥 / token / cookie）——日志会进采集系统，等于对外广播。
 *   3. `x-request-id` 透传优先，缺失时生成 UUID，且对超长/空白输入不照单全收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { log, resolveRequestId } from '@/server/logger';

function capture(): { lines: Record<string, unknown>[]; restore: () => void } {
  const lines: Record<string, unknown>[] = [];
  const push = (raw: unknown): void => {
    for (const arg of Array.isArray(raw) ? raw : [raw]) {
      if (typeof arg === 'string') {
        lines.push(JSON.parse(arg) as Record<string, unknown>);
      }
    }
  };
  const logSpy = vi.spyOn(console, 'log').mockImplementation(push);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(push);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(push);
  return {
    lines,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('logger：单行 JSON + 分级', () => {
  it('每条输出是可 JSON.parse 的对象，字段恒含 level/msg/time', () => {
    const c = capture();
    try {
      log.info('hello', { a: 1 });
      expect(c.lines).toHaveLength(1);
      expect(c.lines[0]).toMatchObject({ level: 'info', msg: 'hello', a: 1 });
      expect(typeof c.lines[0]?.time).toBe('string');
    } finally {
      c.restore();
    }
  });

  it('error 走 stderr、warn 走 stderr、info 走 stdout', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(out).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('LOG_LEVEL 过滤：info 级别下 debug 不输出', () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    const c = capture();
    try {
      log.debug('不该出现');
      log.info('该出现');
      expect(c.lines).toHaveLength(1);
      expect(c.lines[0]?.msg).toBe('该出现');
    } finally {
      c.restore();
    }
  });

  it('LOG_LEVEL=error 时只留 error', () => {
    vi.stubEnv('LOG_LEVEL', 'error');
    const c = capture();
    try {
      log.warn('w');
      log.error('e');
      expect(c.lines.map((l) => l.level)).toEqual(['error']);
    } finally {
      c.restore();
    }
  });
});

describe('logger：敏感信息脱敏', () => {
  it('密钥 / token / cookie 一律替换为 [redacted]', () => {
    const c = capture();
    try {
      log.info('cfg', {
        LLM_API_KEY: 'sk-real-key',
        sessionSecret: 'hunter2',
        authorization: 'Bearer abc',
        cookie: 'cr_session=xyz',
        nested: { embeddingApiKey: 'sk-embed' },
        keep: 'visible',
      });
      const line = JSON.stringify(c.lines[0]);
      expect(line).not.toContain('sk-real-key');
      expect(line).not.toContain('hunter2');
      expect(line).not.toContain('Bearer abc');
      expect(line).not.toContain('cr_session=xyz');
      expect(line).not.toContain('sk-embed');
      expect(line).toContain('visible');
    } finally {
      c.restore();
    }
  });

  it('非对象参数原样透传，不因脱敏逻辑崩掉', () => {
    const c = capture();
    try {
      log.info('n', { n: 1, s: 'x', arr: [1, 2, 3], nil: null });
      expect(c.lines[0]).toMatchObject({ n: 1, s: 'x', arr: [1, 2, 3], nil: null });
    } finally {
      c.restore();
    }
  });
});

describe('resolveRequestId', () => {
  it('上游带了 x-request-id ⇒ 原样沿用（跨服务串联）', () => {
    const request = new Request('http://localhost/api/items', {
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(resolveRequestId(request)).toBe('trace-abc-123');
  });

  it('缺失 / 空白 ⇒ 生成 UUID v4', () => {
    const plain = resolveRequestId(new Request('http://localhost/api/items'));
    const blank = resolveRequestId(
      new Request('http://localhost/api/items', { headers: { 'x-request-id': '   ' } }),
    );
    expect(plain).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(blank).not.toBe(plain);
  });

  it('超长（>128）的 x-request-id 一律丢弃，不进日志', () => {
    const request = new Request('http://localhost/api/items', {
      headers: { 'x-request-id': 'x'.repeat(200) },
    });
    expect(resolveRequestId(request)).not.toBe('x'.repeat(200));
  });
});
