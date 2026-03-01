---
updated: 2026-03-01
---

# 000 架构接口契约

## 1. 文档目标

本文定义 Web App 与本地能力网关（Local Capability Gateway / MCP Host）的 HTTP 契约，
以及网关与后端 MCP Server 的运行契约。  
本文件是首版实现边界，不描述具体业务 UI。

## 2. 网关 API（Gateway API）v1

### 2.1 健康检查（Health Check）

- `GET /v1/health`
- 用途：前端判断网关是否可用。
- 成功响应示例：

```json
{
  "ok": true,
  "data": {
    "service": "fauplay-local-gateway",
    "version": "0.2.0"
  }
}
```

### 2.2 MCP 网关入口（JSON-RPC 2.0）

- `POST /v1/mcp`
- 用途：前端通过单端点调用 MCP 方法。
- 首版支持方法：
  - `tools/list`
  - `tools/call`

请求示例（`tools/list`）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

成功响应示例（HTTP 层包裹）：

```json
{
  "ok": true,
  "data": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "tools": [
        {
          "name": "system.reveal",
          "title": "在文件资源管理器中显示",
          "mutation": false,
          "scopes": ["file"],
          "pluginId": "builtin.reveal"
        },
        {
          "name": "system.openDefault",
          "title": "用系统默认应用打开",
          "mutation": false,
          "scopes": ["file"],
          "pluginId": "builtin.reveal"
        }
      ]
    }
  }
}
```

前端消费约束（当前实现）：

- 预览动作侧栏使用 `tools/list` 返回顺序渲染动作按钮。
- 仅渲染 `scopes` 包含 `file` 的工具。
- 按钮文案使用 `title`（缺省回退 `name`）。

请求示例（`tools/call`）：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
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

## 3. 统一响应结构（Response Envelope）

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "MCP_TOOL_NOT_FOUND",
    "message": "Unknown tool: system.unknown"
  }
}
```

## 4. 错误码（Error Codes）

首版最小集合：

- `MCP_METHOD_NOT_FOUND`：不支持的 MCP 方法。
- `MCP_TOOL_NOT_FOUND`：工具不存在。
- `MCP_INVALID_PARAMS`：参数错误或请求体无效。
- `MCP_SERVER_TIMEOUT`：下游 MCP Server 调用超时。
- `MCP_SERVER_CRASHED`：下游 MCP Server 崩溃或不可用。
- `MCP_TOOL_CALL_FAILED`：工具执行失败。

## 5. MCP Server 运行契约（Plugin Runtime Contract）

### 5.1 插件注册清单（Allowlist Registry）

```ts
type McpPluginRegistryEntry =
  | {
      pluginId: string
      name: string
      version: string
      transport: 'inproc'
      createServer: () => InProcessMcpServer
    }
  | {
      pluginId: string
      name: string
      version: string
      transport: 'stdio'
      command: string
      args?: string[]
      cwd?: string
      env?: Record<string, string>
    }
```

### 5.2 In-Process MCP Server 约定

```ts
type InProcessMcpServer = {
  listTools(): Promise<McpToolDescriptor[]>
  callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>
  shutdown?(): Promise<void>
}
```

### 5.3 Stdio MCP Server 约定

- 网关作为 MCP Host，通过 `stdin/stdout` 发送/接收 JSON-RPC。
- 首版要求插件至少支持：
  - `tools/list`
  - `tools/call`
- 网关负责：
  - 调用超时控制
  - 崩溃隔离
  - 重启节流（cooldown）

## 6. 安全校验约束

1. 所有输入路径必须是相对路径（Relative Path），禁止绝对路径直传 UI。
2. 网关内进行路径归一化（Path Normalization），阻断越界访问。
3. 变更类工具通过 `confirm` 参数区分 dry-run/commit（首版仅定义语义，后续在 M3 落地）。
4. 插件必须通过白名单加载，且 `toolName` 全局唯一。

## 7. 首版必须支持的接口

1. `GET /v1/health`
2. `POST /v1/mcp`（`tools/list` / `tools/call`）

## 8. 当前实现状态（2026-03-01）

1. 已实现：
   - `GET /v1/health`
   - `POST /v1/mcp`
   - `tools/list`
   - `tools/call`
2. 已移除：
   - `GET /v1/capabilities`
   - `POST /v1/actions/execute`
3. 已预留：
   - 变更类工具的 dry-run/commit 语义（`confirm` 参数）
