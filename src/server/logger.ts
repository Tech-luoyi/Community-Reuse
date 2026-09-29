/**
 * 最小结构化日志（`src/server/logger.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.6.3（可观测）/ 本仓库评审结论「每个请求可归因」。
 *
 * **为什么零依赖**：本项目是单进程 Demo，引入 pino/winston 只为一个 JSON 行不划算；
 * 需要的能力只有三条——分级、单行 JSON、可用 `LOG_LEVEL` 降噪。因此直接用 `console`
 * 包一层，换成任何正经日志库时只需替换本文件的四个导出。
 *
 * **输出契约**：`console.log(JSON.stringify(record))` ⇒ 一行一个 JSON 对象，
 * 字段恒为 `{ level, msg, time, ...extra }`。行格式被依赖来做 grep，别改。
 *
 * **纪律**：
 *   1. **不记 PII**：调用方负责脱敏（如 AI 观测标签不含用户输入，见 `ai/service.ts` 的 `label`）。
 *   2. **不记密钥**：`LLM_API_KEY` / `SESSION_SECRET` / `EMBEDDING_API_KEY` 一律不进日志；
 *      写代码时不要把整个 env 或整个请求头塞进来。
 *   3. `test` / `development` 环境下默认 `LOG_LEVEL=info`；生产建议 `info`。
 */

/** 日志级别，由低到高。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 需要额外抹掉 / 替换的键（大小写不敏感）。 */
const REDACTED_KEYS = new Set([
  'apikey',
  'authorization',
  'cookie',
  'embeddingapikey',
  'llm_api_key',
  'llmapikey',
  'password',
  'secret',
  'session_secret',
  'sessionsecret',
  'token',
]);

function isRedacted(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '_');
  return (
    REDACTED_KEYS.has(k) || k.endsWith('_secret') || k.endsWith('_apikey') || k.endsWith('_token')
  );
}

/** 递归脱敏：命中敏感键的值替换为 `'[redacted]'`；深度上限防自引用结构。 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isRedacted(key) ? '[redacted]' : redact(raw, depth + 1);
  }
  return out;
}

function currentThreshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  const level = (['debug', 'info', 'warn', 'error'] as const).find((l) => l === raw);
  return LEVEL_ORDER[level ?? 'info'];
}

function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < currentThreshold()) {
    return;
  }
  const record = {
    level,
    msg,
    time: new Date().toISOString(),
    ...(extra === undefined ? {} : (redact(extra) as Record<string, unknown>)),
  };
  const line = JSON.stringify(record);
  // error 走 stderr：容器编排按流分流，stdout 只留正常业务日志。
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** 结构化日志出口。 */
export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
};

/**
 * 生成一个请求关联 ID。
 *
 * 优先用上游透传的 `x-request-id`（便于跨服务串联），否则用 `crypto.randomUUID`。
 * 响应头会回写这个 ID，客户端报障时截图即可定位到服务端那一行日志。
 */
export function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  if (incoming !== null && incoming.trim() !== '' && incoming.length <= 128) {
    return incoming.trim();
  }
  return crypto.randomUUID();
}
