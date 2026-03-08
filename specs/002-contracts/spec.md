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

1. 网关从项目路径 `.fauplay/mcp.json` 读取主 MCP Server 注册信息（VS Code `mcp.json` 风格），并可选读取 `.fauplay/mcp.local.json` 作为本地覆盖层。
2. 当前仅支持 `servers.<name>.type = "stdio"`。
3. 内置能力需以独立 CLI 形式注册到 `servers` 中（不在网关内硬编码 inproc server）。
4. `stdio` 条目必须提供 `command`（可选 `args/cwd/env`）。
5. `disabled: true` 的 server 必须被跳过。
6. 当主配置与本地覆盖层存在同名 `servers.<name>` 时，本地覆盖层必须优先。
7. server 注册配置不改变 MCP 对外协议字段。

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
3. `toolOptions` 单项最小字段为：`key`、`label`、`type`；首期 `type` 支持 `boolean`、`enum` 与 `string`。
4. `toolOptions` 可选声明 `sendToTool`（默认 `false`）与 `argumentKey`（默认使用 `key`）；当 `sendToTool=true` 时，客户端应将该选项值透传到 `tools/call.arguments`。
5. `toolActions` 单项最小字段为：`key`、`label`；可选 `description`、`intent` 与 `arguments`（对象）。
6. 客户端应按“最小校验 + 忽略非法项”处理注解：无效项不得阻断工具本身可见与可调用性。

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
