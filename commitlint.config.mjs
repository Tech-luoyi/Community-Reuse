/**
 * Conventional Commits 校验（husky `commit-msg` 钩子调用）。
 * 提交格式：`<type>(<scope>)?: <subject>`，例如 `feat(api): 新增 GET /api/items`。
 */
const config = {
  extends: ['@commitlint/config-conventional'],
};

export default config;
