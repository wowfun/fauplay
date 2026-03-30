# 107 过期配置与冗余代码清理规范

> Archived on 2026-03-31. Kept for historical reference.

## 1. 目的 (Purpose)

以不改变用户可见功能为前提，清理仓库中的过期配置、冗余类型别名和错误纳入版本控制的构建缓存，降低维护成本并保持增量构建效率。

## 2. 关键术语 (Terminology)

- 过期配置（Stale Config）
- 冗余别名层（Redundant Alias Layer）
- 构建缓存污染（Build Cache Pollution）
- 单一配置源（Single Source of Config Truth）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 合并 TypeScript 构建配置，收敛到根 `tsconfig.json`。
2. 移除被错误跟踪的 `tsbuildinfo` 构建缓存文件。
3. 删除未被入口可达图引用的预览类型别名文件。
4. 补充 Git 忽略规则，防止缓存文件再次入库。

范围外：

1. 业务逻辑变更与 UI 调整。
2. 文档体系重写（仅追加必要变更记录）。
3. `specs/_archive` 历史归档清理。

## 4. 用户可见行为契约 (User-visible Contract)

1. 前端功能与交互行为保持不变。
2. `npm run build` 仍可完成 `tsc -b` 增量构建与 Vite 打包。
3. 构建后仓库不再因根目录 `tsconfig.tsbuildinfo` 产生脏改动。

## 5. 配置与代码清理契约 (Cleanup Contract)

1. `FR-SC-01` 根 `tsconfig.json` 必须包含 `composite=true` 与 `tsBuildInfoFile`，作为唯一 TS 增量构建配置入口。
2. `FR-SC-02` 冗余的 `tsconfig.app.json` 必须删除，避免双配置漂移。
3. `FR-SC-03` 根目录 `tsconfig.tsbuildinfo` 必须删除且不再纳入版本控制。
4. `FR-SC-04` `.gitignore` 必须显式忽略 `*.tsbuildinfo`。
5. `FR-SC-05` 未被引用的类型别名文件 `src/features/preview/types/toolResult.ts` 与 `src/features/preview/types/toolWorkbench.ts` 必须删除。

## 6. 验收标准 (AC)

1. `AC-SC-01` `npm run typecheck` 通过。
2. `AC-SC-02` `npm run lint` 通过。
3. `AC-SC-03` `npm run build` 通过。
4. `AC-SC-04` 构建后 `git status --short` 不再出现 `tsconfig.tsbuildinfo` 被改写。
5. `AC-SC-05` 代码库中不存在对已删除类型别名文件的活动引用。

## 7. 默认值与一致性约束 (Defaults & Consistency)

1. 保持 `tsc -b` 作为构建入口，不切换到 `tsc --noEmit`。
2. 仅清理高置信冗余项，不主动扩展到低置信历史残留。
3. 变更记录仅追加到 `specs/CHANGELOG.md` 的主要变更项。

## 8. 关联主题 (Related Specs)

- 架构边界：[`../../../001-architecture/spec.md`](../../../001-architecture/spec.md)
- 契约规范：[`../../../002-contracts/spec.md`](../../../002-contracts/spec.md)
- 插件运行时交互：[`../../../105-plugin-runtime-interaction/spec.md`](../../../105-plugin-runtime-interaction/spec.md)
