# 007 Package Management 包管理规范

## 1. 目的 (Purpose)

定义 Fauplay 的 JavaScript 包管理器（Package Manager）真源，统一依赖安装、脚本执行与锁文件维护方式，避免 npm / pnpm / yarn 混用导致依赖树和开发命令分叉。

## 2. 关键术语 (Terminology)

- 包管理器（Package Manager）
- 锁文件（Lockfile）
- 脚本入口（Script Entry）

术语口径：

1. `Package Manager`：项目依赖安装、锁文件生成与 `package.json#scripts` 执行工具。
2. `Lockfile`：提交到仓库、用于固定依赖解析结果的锁文件。
3. `Script Entry`：通过包管理器调用的项目脚本，例如 `pnpm run dev`。

## 3. 包管理器契约 (Package Manager Contract)

1. Fauplay 的 JavaScript 包管理器固定为 `pnpm`。
2. `package.json#packageManager` 必须声明当前项目使用的 pnpm 版本。
3. 依赖锁文件真源固定为 `pnpm-lock.yaml`。
4. `pnpm-workspace.yaml` 可作为 pnpm 项目级设置文件使用；在仓库没有多包结构前，不声明 `packages` workspace 范围。
5. 仓库不得提交 `package-lock.json`、`npm-shrinkwrap.json`、`yarn.lock` 等其他 JavaScript 包管理器锁文件。
6. 项目文档、脚本提示与验证命令应使用 `pnpm install`、`pnpm run <script>` 或 `pnpm dlx <package>` 表达。
7. 需要执行安装期 build script 的依赖必须显式写入 `pnpm-workspace.yaml#allowBuilds`。

## 4. 开发者入口 (Developer Interfaces)

1. 安装依赖：`pnpm install`
2. 本地前端开发：`pnpm run dev`
3. 启动 Gateway：`pnpm run gateway`
4. 生成本地 HTTPS 证书：`pnpm run dev:https:setup`
5. 启动本地 HTTPS 前端：`pnpm run dev:https`
6. 类型检查：`pnpm run typecheck`
7. 代码检查：`pnpm run lint`

## 5. 验收约束 (Acceptance Constraints)

1. `pnpm install --frozen-lockfile` 必须能在干净环境中复现依赖安装。
2. 修改代码后，最小验证命令为 `pnpm run typecheck` 与 `pnpm run lint`。
3. `pnpm-workspace.yaml` 仅用于 pnpm 项目级设置时，不得额外声明 workspace 包范围。

## 6. 关联主题 (Related Specs)

- 性能治理规范：[`../004-performance-governance/spec.md`](../004-performance-governance/spec.md)
