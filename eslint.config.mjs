import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * ESLint flat config。
 * - 基线：`next/core-web-vitals` + `next/typescript`（内含 @typescript-eslint 推荐集）
 * - 追加：禁止 `any` 与未使用变量、D8 解耦守卫（no-restricted-imports）
 * - 末位：`prettier`（关闭与 Prettier 冲突的格式规则）
 */
const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'dist/**',
      'public/uploads/**',
      '.review/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // D8 解耦硬约束：后端不得引用任何前端组件 / 页面 / hooks 类型。
    files: ['src/server/**/*.ts', 'src/app/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/components', '@/components/*', '**/components/**'],
              message: 'D8：后端禁止引用前端组件（src/components/**）。',
            },
            {
              group: ['@/app/*/page', '@/app/**/page', '**/page', '**/page.tsx'],
              message: 'D8：后端禁止引用页面组件（page.tsx）。',
            },
            {
              group: ['@/hooks', '@/hooks/*', '@/lib', '@/lib/*'],
              message: 'D8：后端禁止引用前端 hooks / lib。',
            },
          ],
        },
      ],
    },
  },
  ...compat.extends('prettier'),
];

export default eslintConfig;
