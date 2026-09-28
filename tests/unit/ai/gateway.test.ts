/**
 * LLM 网关的单测（**mock `fetch`，离线**）。
 *
 * 覆盖 §6.1 的重试/超时/认证纪律：
 *   - 无 Key ⇒ **不发请求**，返回 `no_key`（供上层直接降级）。
 *   - 网络错误 / 5xx / 超时 ⇒ **重试恰好 1 次**（即共 2 次 `fetch`），仍失败才归因。
 *   - 4xx ⇒ **不重试**（共 1 次 `fetch`）。
 *   - 空内容 ⇒ 归因 `empty`（不重试）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callModel, getGatewayConfig, hasApiKey, type ChatMessage } from '@/server/ai/gateway';

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];

/** 极简响应替身（只暴露网关实际读取的 `status` / `json()`）。 */
function jsonResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

describe('网关配置', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('无 key ⇒ 配置为 null、hasApiKey=false', () => {
    vi.stubEnv('LLM_API_KEY', '');
    expect(getGatewayConfig()).toBeNull();
    expect(hasApiKey()).toBe(false);
  });

  it('有 key ⇒ 默认 model=deepseek-chat，baseUrl 去尾斜杠', () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    vi.stubEnv('LLM_BASE_URL', 'https://example.test///');
    vi.stubEnv('LLM_MODEL', '');
    expect(getGatewayConfig()).toEqual({
      baseUrl: 'https://example.test',
      apiKey: 'k',
      model: 'deepseek-chat',
    });
  });
});

describe('callModel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('无 Key ⇒ 直接返回 no_key 且**一次 fetch 都不发**', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    const result = await callModel({ messages: MESSAGES, maxTokens: 100, temperature: 0.3 });
    expect(result).toEqual({ ok: false, reason: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('成功 ⇒ 返回内容，并把 OpenAI 兼容请求体拼装正确', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    vi.stubEnv('LLM_BASE_URL', 'https://example.test');
    fetchMock.mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: '{"hello":"world"}' } }] }),
    );

    const result = await callModel({ messages: MESSAGES, maxTokens: 300, temperature: 0.7 });
    expect(result).toEqual({ ok: true, content: '{"hello":"world"}' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/chat/completions');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(300);
    expect(body.temperature).toBe(0.7);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('5xx ⇒ 重试 1 次（共 2 次 fetch），仍失败归因 http_5xx', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    const result = await callModel({ messages: MESSAGES, maxTokens: 100, temperature: 0.3 });
    expect(result).toMatchObject({ ok: false, reason: 'http_5xx', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('400 / 401 ⇒ **不重试**（共 1 次 fetch），归因 http_4xx', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockResolvedValue(jsonResponse(400, {}));
    const bad = await callModel({ messages: MESSAGES, maxTokens: 100, temperature: 0.3 });
    expect(bad).toMatchObject({ ok: false, reason: 'http_4xx', status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const unauthorized = await callModel({ messages: MESSAGES, maxTokens: 100, temperature: 0.3 });
    expect(unauthorized).toMatchObject({ ok: false, reason: 'http_4xx', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络错误 ⇒ 重试 1 次（共 2 次 fetch），归因 network', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await callModel({ messages: MESSAGES, maxTokens: 100, temperature: 0.3 });
    expect(result).toEqual({ ok: false, reason: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('超时 ⇒ 按 AbortController 归因 timeout 且重试 1 次（共 2 次 fetch）', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const result = await callModel({
      messages: MESSAGES,
      maxTokens: 100,
      temperature: 0.3,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('响应内容为空 ⇒ 归因 empty 且**不重试**', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: '' } }] }));
    const result = await callModel({ messages: MESSAGES, maxTokens: 100, temperature: 0.3 });
    expect(result).toEqual({ ok: false, reason: 'empty' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
