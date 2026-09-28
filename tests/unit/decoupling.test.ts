import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

/** D8 解耦硬约束（api-contract.md §10）：后端不得引用前端组件 / 页面 / hooks / lib。 */
const BACKEND_DIRS = ['src/server', 'src/app/api'];
const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
  /^@\/components(\/|$)/,
  /components\//,
  /^@\/hooks(\/|$)/,
  /^@\/lib(\/|$)/,
  /^@\/app(\/|$)/,
  /(^|\/)page$/,
];

function collectTsFiles(dir: string): string[] {
  const absolute = join(projectRoot, dir);
  const files: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(join(dir, entry)));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticImport = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let match = staticImport.exec(source);
  while (match !== null) {
    const specifier = match[1];
    if (typeof specifier === 'string') {
      specifiers.push(specifier);
    }
    match = staticImport.exec(source);
  }
  return specifiers;
}

describe('D8 解耦纪律 · 后端不得引用前端', () => {
  const files = BACKEND_DIRS.flatMap((dir) => collectTsFiles(dir));

  it('至少扫描到一个后端文件（防止测试空转）', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('src/server/** 与 src/app/api/** 的 import 不含前端路径', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))) {
          violations.push(`${file.replace(projectRoot, '')} → ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
