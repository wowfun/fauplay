- 规格先行，在代码实现前，永远记得先 READ/UPDATE/CREATE `specs/<topic>/spec.md`
- 实现落地后更新 `specs/CHANGELOG.md`（仅主要变更）
- 快捷键变更时，同步更新 `src/config/shortcuts.ts` 与 `docs/shortcuts.md`
- Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`)

## 提交与验证最小清单
仅在修改代码后执行：
```bash
npm run typecheck
npm run lint
```
