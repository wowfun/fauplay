# 105 MCP Plugin Layout 插件目录布局规范

## 1. 目的 (Purpose)

定义 Fauplay MCP 插件目录布局与独立调试契约，统一插件落位、入口命名与 Inspector 调试最小流程，降低后续新增插件的接入与维护成本。

## 2. 关键术语 (Terminology)

- MCP 插件目录（MCP Plugin Directory）
- 插件入口脚本（Plugin Entrypoint）
- 标准输入输出传输（Stdio Transport）
- 本地覆盖配置（Local Override Config）
- 生命周期调用序列（Lifecycle Sequence）
- MCP Inspector 独立调试（Standalone Inspector Debugging）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. MCP 插件目录从 `scripts/gateway/mcp-servers` 迁移到顶层 `tools/mcp`。
2. 每个插件使用独立子目录与统一入口命名：`tools/mcp/<plugin>/server.(mjs|py)`。
3. 主配置 `.fauplay/mcp.json` 与本地覆盖 `.fauplay/mcp.local.json` 的合并加载规则。
4. 提供 Inspector 通用操作指引文档，约束独立调试流程。
5. 私有插件目录 `tools/mcp-local` 的 Git 忽略约束。

范围外：

1. `scripts/gateway/mcp` 运行时目录迁移或重构。
2. 网关 `POST /v1/mcp` 协议行为变更。
3. 按插件列出的专项评估清单。

## 4. 用户可见行为契约 (User-visible Contract)

1. 迁移后网关加载行为保持一致，已有工具对前端仍可发现与调用。
2. 插件必须可被 MCP Inspector 作为独立 stdio 进程拉起，不依赖 Fauplay 网关代理。
3. 使用 Inspector 调试时，插件必须完成最小生命周期：`initialize` -> `notifications/initialized` -> `tools/list`。
4. Inspector 文档必须保持通用化，不包含插件名录与插件逐项评估表。

## 5. 目录与配置契约 (Layout & Config Contract)

1. `FR-ML-01` MCP 插件根目录必须为 `tools/mcp`。
2. `FR-ML-02` 每个插件必须在独立目录下提供单一入口文件 `server.*`。
3. `FR-ML-03` 插件目录名必须与 `.fauplay/mcp.json` 的 `servers.<name>` 语义可对应，避免歧义。
4. `FR-ML-04` 网关必须先读取 `.fauplay/mcp.json`，再尝试读取 `.fauplay/mcp.local.json` 并合并。
5. `FR-ML-05` 同名 `servers.<name>` 冲突时，本地覆盖层（`mcp.local.json`）必须完整覆盖主配置。
6. `FR-ML-06` `.fauplay/mcp.local.json` 与 `tools/mcp-local/` 必须默认加入 Git 忽略。
7. `FR-ML-07` `.fauplay/mcp.json` 与 `.fauplay/mcp.local.json` 的 `command/args/cwd/env` 字段语义保持一致。
8. `FR-ML-08` 本地覆盖配置存在但 JSON 非法时，网关必须以配置错误失败启动并标注错误文件路径。
9. `FR-ML-09` 不得保留旧目录兼容层（软链接、跳转脚本或双路径注册）。

## 6. Inspector 调试契约 (Inspector Debugging Contract)

1. `FR-ML-10` 任意插件入口必须兼容 stdio JSON-RPC 输入输出，支持 Inspector 直接连接。
2. `FR-ML-11` 插件必须支持 `initialize`、`notifications/initialized`、`tools/list` 三步最小调试链路。
3. `FR-ML-12` Inspector 指引文档必须覆盖：
   - Inspector 安装/启动方式
   - `command` / `args` / `env` / `cwd` 字段填写原则
   - 生命周期调试顺序
   - 常见错误与排查方法
4. `FR-ML-13` Inspector 指引文档不得包含固定插件清单，必须可复用于后续新增插件。

## 7. 验收标准 (AC)

1. `AC-ML-01` 仓库不存在活动路径引用 `scripts/gateway/mcp-servers`（历史 changelog 可保留）。
2. `AC-ML-02` `.fauplay/mcp.json` 中所有插件注册路径指向 `tools/mcp/<plugin>/server.*`。
3. `AC-ML-03` `.fauplay/mcp.local.json` 可选缺省，缺省时网关仍可正常启动并加载主配置。
4. `AC-ML-04` 当主配置与本地覆盖层存在同名 server 时，本地覆盖层配置生效。
5. `AC-ML-05` 使用 Inspector 对任意一个插件执行 `initialize`、`notifications/initialized`、`tools/list` 成功返回。
6. `AC-ML-06` `docs/mcp-inspector.md` 仅提供通用指引，不出现插件清单章节。
7. `AC-ML-07` `.gitignore` 已忽略 `.fauplay/mcp.local.json` 与 `tools/mcp-local/`。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. 插件入口命名默认使用 `server` 前缀，后缀按语言选择。
2. 插件目录结构变化不得改变工具名、输入输出契约和错误码语义。
3. 迁移后相关文档路径引用必须与配置文件保持一致。

## 9. 关联主题 (Related Specs)

- 架构边界：[`../001-architecture/spec.md`](../001-architecture/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- `timm` 插件契约：[`../104-timm-classification-mcp/spec.md`](../104-timm-classification-mcp/spec.md)
