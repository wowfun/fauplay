# MCP Inspector 通用调试指引

本文档提供 Fauplay MCP 插件的通用调试流程，不绑定具体插件清单。

## 1. 目标

用于验证任意 MCP 插件是否可被 Inspector 独立拉起，并完成最小生命周期：

1. `initialize`
2. `notifications/initialized`
3. `tools/list`

## 2. 前置条件

1. 已安装 Node.js（建议使用项目当前 LTS 版本）。
2. 插件可执行命令在当前环境可用（如 `node`、`python3`）。
3. 插件所需运行时依赖已安装（按插件自身要求准备）。

## 3. 启动 Inspector

方式 A（先开 Inspector，再在界面配置连接）：

```bash
npx @modelcontextprotocol/inspector
```

方式 B（命令行直接附带 server 启动命令）：

```bash
npx @modelcontextprotocol/inspector <command> <arg1> <arg2> ...
```

说明：若网络较慢，`npx` 首次拉取依赖可能耗时较长。

## 4. Stdio 连接参数填写规则

在 Inspector 里选择 `stdio` 传输后，按以下原则填写：

1. `command`
   - 填可执行程序名，例如 `node`、`python3`。
2. `args`
   - 按空格分隔后的参数数组逐项填写。
   - 入口脚本建议使用仓库相对路径（例如 `tools/mcp/<plugin>/server.*`）。
3. `cwd`
   - 建议填仓库根目录绝对路径，避免相对路径解析错误。
4. `env`
   - 按需填写 `KEY=VALUE`。
   - 仅传插件运行必要变量，减少环境噪音。

## 5. 最小生命周期调试顺序

1. 发送 `initialize`
   - `jsonrpc` 必须为 `2.0`。
   - 建议携带 `clientInfo` 与空 `capabilities`。
2. 发送 `notifications/initialized`
   - 该调用通常不带 `id`（notification）。
3. 发送 `tools/list`
   - 预期返回 `result.tools` 数组。

判定通过标准：

1. 三步调用均返回成功（或 notification 按协议无错误）。
2. `tools/list` 返回可解析工具列表。

## 6. 常见错误与排查

1. `command not found`
   - 检查 `command` 是否在当前 shell `PATH` 可执行。
2. 启动即退出 / 无响应
   - 检查 `args` 是否遗漏必需参数。
   - 检查 `cwd` 是否导致相对路径失效。
3. `Parse error` / `Invalid Request`
   - 检查请求是否符合 JSON-RPC 2.0 基本字段要求。
4. `Method not found`
   - 插件未实现对应生命周期方法，或方法名拼写错误。
5. 插件工具未出现
   - 先确认 `initialize` 与 `notifications/initialized` 顺序正确，再执行 `tools/list`。
