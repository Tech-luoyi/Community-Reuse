/**
 * 上传落盘与校验的单测（`src/server/storage/*`，不连库）。
 *
 * 钉死契约 §3 的三条服务端独立校验（**不信任前端压缩**）：
 *   - 类型白名单 `image/jpeg|png|webp` → 否则 `INVALID_INPUT`；
 *     特别是 **SVG 必须被拒**（可携带脚本，且本项目 `next.config.ts` 从不放开 SVG）。
 *   - 单张 >5 MiB → `PAYLOAD_TOO_LARGE`，且**在读取字节之前**判定（不为注定被拒的大文件分配内存）。
 *   - `key` 由服务端构造：`randomUUID() + 白名单扩展名`，客户端文件名一律不采信 ⇒
 *     落盘路径不可能被 `../` 影响。
 *
 * 写盘走**临时目录**（`UPLOAD_DIR` 注入），绝不往 `public/uploads` 塞测试文件。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_UPLOAD_BYTES } from '@/shared/schemas';
import { isAppError } from '@/server/errors';
import { extensionFor, putUpload } from '@/server/storage';
import { DEFAULT_UPLOAD_DIR, resolveUploadDir } from '@/server/storage/local';

function fakeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return isAppError(error) ? error.code : `NON_APP:${String(error)}`;
  }
  return undefined;
}

async function codeOfAsync(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return isAppError(error) ? error.code : `NON_APP:${String(error)}`;
  }
  return undefined;
}

describe('extensionFor：MIME 白名单（服务端独立校验）', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['IMAGE/PNG', 'png'],
  ])('%s → %s', (mime, ext) => {
    expect(extensionFor(mime)).toBe(ext);
  });

  it.each(['image/svg+xml', 'image/gif', 'application/x-httpd-php', 'text/plain', '', 'binary'])(
    '非白名单 %o → INVALID_INPUT',
    (mime) => {
      expect(codeOf(() => extensionFor(mime))).toBe('INVALID_INPUT');
    },
  );
});

describe('resolveUploadDir：UPLOAD_DIR 口径', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.UPLOAD_DIR;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = saved;
    }
  });

  it('未设置时用默认目录', () => {
    delete process.env.UPLOAD_DIR;
    expect(resolveUploadDir()).toBe(path.resolve(process.cwd(), DEFAULT_UPLOAD_DIR));
  });

  it('相对路径按项目根展开；绝对路径原样', () => {
    process.env.UPLOAD_DIR = './tmp-x/uploads';
    expect(resolveUploadDir()).toBe(path.resolve(process.cwd(), 'tmp-x/uploads'));
    process.env.UPLOAD_DIR = path.join(tmpdir(), 'abs-uploads');
    expect(resolveUploadDir()).toBe(path.join(tmpdir(), 'abs-uploads'));
  });
});

describe('putUpload：大小 / 类型 / key 生成', () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(async () => {
    saved = process.env.UPLOAD_DIR;
    dir = await mkdtemp(path.join(tmpdir(), 'cr-uploads-'));
    process.env.UPLOAD_DIR = dir;
  });

  afterEach(async () => {
    if (saved === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = saved;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('合法 PNG → 落盘 uuid.png，url 为 /uploads/<key>', async () => {
    const result = await putUpload(fakeFile('../../evil.png', 'image/png', 128));
    expect(result.key).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.png$/);
    expect(result.url).toBe(`/uploads/${result.key}`);
    expect(await readdir(dir)).toEqual([result.key]);
  });

  it('超过 5 MiB → PAYLOAD_TOO_LARGE 且**不落盘**', async () => {
    const tooBig = fakeFile('big.jpg', 'image/jpeg', MAX_UPLOAD_BYTES + 1);
    expect(await codeOfAsync(() => putUpload(tooBig))).toBe('PAYLOAD_TOO_LARGE');
    expect(await readdir(dir)).toEqual([]);
  });

  it('恰好 5 MiB 放行（边界为闭）', async () => {
    const result = await putUpload(fakeFile('edge.jpg', 'image/jpeg', MAX_UPLOAD_BYTES));
    expect(result.key.endsWith('.jpg')).toBe(true);
  });

  it('空文件 → INVALID_INPUT', async () => {
    expect(await codeOfAsync(() => putUpload(fakeFile('e.webp', 'image/webp', 0)))).toBe(
      'INVALID_INPUT',
    );
  });

  it('类型不合法优先于大小（先看能不能收，再看收多大）', async () => {
    const svg = fakeFile('x.svg', 'image/svg+xml', MAX_UPLOAD_BYTES + 1);
    expect(await codeOfAsync(() => putUpload(svg))).toBe('INVALID_INPUT');
  });
});
