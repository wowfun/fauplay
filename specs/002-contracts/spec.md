# 002 Contracts 契约规范

## 目的

定义 Fauplay 的 MCP 契约（MCP Contracts），用于约束浏览器前端（Web App）与本地能力网关（Local Capability Gateway / MCP Host）之间的协议交互行为。

## 关键术语 (Terminology)

- 模型上下文协议（Model Context Protocol, MCP）
- JSON-RPC 2.0
- 生命周期（Lifecycle）
- 工具发现（Tool Discovery）
- 工具调用（Tool Call）

## 范围

范围内：

- MCP 生命周期方法与顺序约束。
- `POST /v1/mcp` 的 JSON-RPC 请求/响应契约。
- `tools/list`、`tools/call` 的标准结果结构。
- 错误响应结构与扩展错误码承载方式。

范围外：

- UI 展示与交互细节（归属 `003-ui-ux`）。
- 分层架构原则（归属 `001-architecture`）。
- 功能专题的业务行为细节（归属 `100+` 主题）。

## 契约版本与原则

1. 本规范采用 MCP 标准优先（Standard-First）。
2. 当前目标协议版本：`2025-11-05`。
3. 当前对外响应仅使用 MCP 标准字段，不返回非标准扩展字段。

## 传输入口 (Transport Entry)

### MCP 入口

- `POST /v1/mcp`
- 内容类型：`application/json`
- 请求体：JSON-RPC 2.0 对象
- 响应体：JSON-RPC 2.0 对象（或通知场景下无响应体）

约束：

1. MCP 入口不使用 `ok/data` HTTP 包裹。
2. MCP 语义以 JSON-RPC 字段为准（`jsonrpc`、`id`、`method`、`params`、`result`、`error`）。
3. MCP 会话通过 HTTP Header `mcp-session-id` 传递。

### 健康检查（非 MCP）

- `GET /v1/health` 仅用于诊断网关在线状态，不属于 MCP 核心协议。

### Server 注册配置（Host Registration）

1. MCP 插件活动目录基线为 `tools/mcp/<plugin>/server.*`，`servers.<name>` 的注册路径应与该目录布局语义对应。
2. MCP 注册表属于 app-owned config；网关必须先读取 repo 默认注册配置 `src/config/mcp.json`，再可选读取全局覆盖 `~/.fauplay/global/mcp.json`。
3. 当前仅支持 `servers.<name>.type = "stdio"`。
4. 内置能力需以独立 CLI 形式注册到 `servers` 中（不在网关内硬编码 inproc server）。
5. `stdio` 条目必须提供 `command`（可选 `args/cwd/env`）。
6. `disabled: true` 的 server 必须被跳过。
7. 当默认配置与全局覆盖存在同名 `servers.<name>` 时，必须按 server key 合并；server 对象内字段由全局层做浅覆盖。
8. 全局覆盖配置文件存在但 JSON 非法时，网关必须以配置错误失败启动并标注错误文件路径。
9. Gateway 启动期不得读取 `<root>/.fauplay/mcp.json` 或任何 `*.local.json` 作为 MCP 注册兼容路径。
10. 注册体系不得保留旧目录兼容层（软链接、跳转脚本或双路径并存注册）。
11. Server 注册配置不改变 MCP 对外协议字段。
12. Gateway 启动日志必须打印本次实际读取的 MCP 配置文件路径；默认模式至少打印 `default` 与 `global` 两层，其中缺失的可选全局覆盖必须明确标注为“missing, skipped”；显式传入自定义 `mcpConfigPath` 时必须打印 `custom` 配置路径。
13. 工具内部默认配置属于 tool-owned config，默认应与工具一起发布在 `tools/mcp/<tool>/config.json`；它们不参与 `src/config -> ~/.fauplay/global` 的 MCP 注册表分层。
14. 如需 Host 级覆盖工具内部配置，必须通过 `~/.fauplay/global/mcp.json` 显式改写对应 server 的 `args/env/command/cwd`；Gateway 不得隐式读取 `~/.fauplay/global/<tool>.json` 作为工具内建覆盖层。

## 生命周期契约 (Lifecycle Contract)

客户端与网关的交互顺序：

1. `initialize`
2. `notifications/initialized`
3. 其他能力方法（如 `tools/list`、`tools/call`）

### `initialize`

请求示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "fauplay-web",
      "version": "0.0.1"
    }
  }
}
```

响应示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "fauplay-local-gateway",
      "version": "0.2.0"
    }
  }
}
```

说明：`initialize` 成功后，网关必须在 HTTP 响应头返回 `mcp-session-id`。

### `notifications/initialized`

前置条件：请求头必须包含 `mcp-session-id`（来自 `initialize` 响应）。

请求示例（通知，无 `id`）：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

## 工具方法契约 (Tools Contract)

### `tools/list`

用途：返回 MCP 标准工具列表。

前置条件：请求头必须包含 `mcp-session-id`，且客户端已发送 `notifications/initialized`。

请求示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

响应示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "system.reveal",
        "title": "在文件资源管理器中显示",
        "description": "在文件资源管理器中显示",
        "inputSchema": {
          "type": "object",
          "properties": {
            "rootPath": { "type": "string" },
            "relativePath": { "type": "string" }
          },
          "required": ["rootPath", "relativePath"],
          "additionalProperties": false
        },
        "annotations": {
          "mutation": false,
          "scopes": ["file"]
        }
      }
    ]
  }
}
```

约束：

1. 标准返回字段为 `result.tools`（可选 `result.nextCursor`）。
2. 不在 `result` 顶层返回 `plugins`。
3. 当前 `tools/list` 不返回非标准来源字段。
4. 工具注解允许通过 `annotations.toolOptions` 与 `annotations.toolActions` 暴露前端工作台元数据。

### `tools/list` 注解约定（Tool Workbench Metadata）

用途：在不改变 `tools/call` 主体结构的前提下，为前端提供工具工作台渲染所需元数据。

约束：

1. `annotations.toolOptions` 为可选数组；缺失或空数组表示“该工具无可展示选项”。
2. `annotations.toolActions` 为可选数组；缺失或空数组表示“该工具无可展示操作”。
3. `annotations.icon` 为可选字符串，语义为 Lucide 图标名（支持 PascalCase 或 kebab-case 命名）。
4. `toolOptions` 单项最小字段为：`key`、`label`、`type`；首期 `type` 支持 `boolean`、`enum` 与 `string`。
5. `toolOptions` 可选声明 `sendToTool`（默认 `false`）与 `argumentKey`（默认使用 `key`）；当 `sendToTool=true` 时，客户端应将该选项值透传到 `tools/call.arguments`。
6. `toolActions` 单项最小字段为：`key`、`label`；可选 `description`、`intent`、`arguments`（对象）与 `visible`（布尔值）。
7. 当 `toolActions[].visible === false` 时，客户端工作台不得渲染该操作；缺失时按可见处理。
8. 客户端应按“最小校验 + 忽略非法项”处理注解：`icon` 空值、非法值或不可解析值不得阻断工具本身可见与可调用性，客户端应回退默认图标策略。

### `tools/call`

用途：调用指定工具。

前置条件：请求头必须包含 `mcp-session-id`，且客户端已发送 `notifications/initialized`。

请求示例：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "system.reveal",
    "arguments": {
      "rootPath": "D:\\Media",
      "relativePath": "albums/a.jpg"
    }
  }
}
```

约束：

1. `params.name` 必须为非空字符串。
2. `params.arguments` 必须为对象（可为空对象）。

### 作用域同构约定（Scope-isomorphic Runtime Semantics）

用途：约束 `workspace` 与 `file` 两类工具在前端消费层保持同一交互语义，仅资源上下文不同。

约束：

1. 当工具声明 `annotations.scopes=["file"]` 或 `["workspace"]` 时，客户端必须按相同的工作台元数据解析规则消费 `toolOptions/toolActions`。
2. 客户端不得为 `workspace` 与 `file` 维护两套不兼容的工作台元数据协议。
3. 变更类与批处理类工具的 `result` 建议采用“顶层汇总 + item 逐项结果”结构，并允许部分成功。
4. 当工具返回逐项结果时，单项失败不应强制提升为整批传输失败；调用失败（JSON-RPC `error`）仅用于请求级异常。

## 错误契约 (Error Contract)

错误响应使用 JSON-RPC 标准结构：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "code": "MCP_INVALID_PARAMS"
    }
  }
}
```

约束：

1. `error.code` 使用 JSON-RPC 整数错误码。
2. 网关内部语义错误码（如 `MCP_TOOL_NOT_FOUND`）放入 `error.data.code`。
3. 客户端必须优先按 JSON-RPC 错误结构处理失败。
4. 当 `mcp-session-id` 缺失或无效时，返回 `-32600`，并在 `error.data.code` 使用 `MCP_INVALID_REQUEST`。

## 安全契约 (Security Contract)

1. 工具名与参数必须做基础合法性校验。
2. 路径相关参数必须做路径归一化（Path Normalization）防止越界访问。
3. 文件变更类工具应预留 `confirm` 语义用于 dry-run/commit 区分（功能专题细化）。

## 非目标

1. 不定义 UI 组件与交互设计。
2. 不定义网关内部扩展实现细节（如插件加载机制）。
3. 不定义任务拆解、排期和里程碑。

## 关联主题

- 上游基线：`000-foundation`
- 架构边界：`001-architecture`
- 交互规范：`003-ui-ux`
- 插件运行时交互：`105-plugin-runtime-interaction`
