# 002 Contracts 契约规范

## 目的

定义 Fauplay 的 MCP 契约（MCP Contracts），用于约束浏览器前端（Web App）与本地能力网关（Local Capability Gateway / MCP Host）之间的协议交互行为。

## 关键术语 (Terminology)

- 模型上下文协议（Model Context Protocol, MCP）
- JSON-RPC 2.0
- 生命周期（Lifecycle）
- 工具发现（Tool Discovery）
- 工具调用（Tool Call）
- 结果投射（Result Projection）

## 范围

范围内：

- MCP 生命周期方法与顺序约束。
- `POST /v1/mcp` 的 JSON-RPC 请求/响应契约。
- `/v1/remote/*` 只读 HTTP 请求/响应入口约束。
- `tools/list`、`tools/call` 的标准结果结构。
- `tools/call` 可选结果投射扩展结构。
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

### 本机管理 HTTP 入口（Loopback-only Admin HTTP Entry）

- `GET /v1/admin/remembered-devices`
- `PATCH /v1/admin/remembered-devices/:deviceId`
- `DELETE /v1/admin/remembered-devices/:deviceId`
- `POST /v1/admin/remembered-devices/revoke-all`
- `POST /v1/admin/remote-published-roots/sync-from-local-browser`

约束：

1. `/v1/admin/*` 固定属于 loopback-only 本机管理面，不属于 `/v1/remote/*` 远程公开数据面。
2. `/v1/admin/*` 不得被 LAN 发布面代理出去，也不得作为 same-origin 远程 helper 对外暴露。
3. `/v1/admin/*` 只返回管理页所需的最小 DTO，不得返回 cookie 原值、token 原值、完整 `User-Agent` 原文或其他非必要敏感字段。
4. remembered-device 管理接口的撤销语义必须同步失效被撤销设备关联的活动 session。
5. `POST /v1/admin/remote-published-roots/sync-from-local-browser` 固定为 loopback-only 本机同步入口；它可接收 `absolutePath`，但该能力不得复用到 `/v1/remote/*`。
6. roots 自动发布同步接口的请求体必须是全量快照 `Array<{ label: string; absolutePath: string; favoritePaths: string[] }>`；缺席 root 表示下线，不是增量保留。

### 只读远程 HTTP 入口（Read-only Remote HTTP Entry）

- `GET /v1/remote/capabilities`
- `POST /v1/remote/session/login`
- `POST /v1/remote/session/logout`
- `GET /v1/remote/roots`
- `POST /v1/remote/files/list`
- `POST /v1/remote/files/text-preview`
- `GET /v1/remote/files/content`
- `GET /v1/remote/files/thumbnail`
- `POST /v1/remote/tags/options`
- `POST /v1/remote/tags/query`
- `POST /v1/remote/tags/file`
- `POST /v1/remote/faces/list-people`
- `POST /v1/remote/faces/list-person-faces`
- `GET /v1/remote/faces/crops/:faceId`
- `GET /v1/remote/favorites`
- `POST /v1/remote/favorites/upsert`
- `POST /v1/remote/favorites/remove`

约束：

1. `/v1/remote/*` 不属于 MCP / JSON-RPC 入口，必须返回普通 HTTP JSON 或二进制响应。
2. `GET /v1/remote/capabilities` 必须允许未登录访问，用于探测远程只读能力与运行态鉴权模式。
3. `POST /v1/remote/session/login` 必须要求 `Authorization: Bearer <token>`，并可接受可选 JSON 请求体 `{ rememberDevice?: boolean, rememberDeviceLabel?: string }`；成功后由服务端设置同源 session cookie。
4. 当登录请求显式启用 `rememberDevice=true` 时，服务端可以额外设置同源 remember-device cookie；浏览器不得因此长期持久化原始 Bearer token。
5. 除 `GET /v1/remote/capabilities` 与登录接口外，`/v1/remote/*` 必须基于 session cookie 鉴权；当 session 缺失或过期但 remember-device cookie 仍有效时，服务端可透明补发新的 session cookie 并继续处理请求。
6. `POST /v1/remote/session/logout` 可接受可选 JSON 请求体 `{ forgetDevice?: boolean }`；默认仅清除当前 session，`forgetDevice=true` 时还必须同时撤销当前 remembered device 并清除对应 cookie。
7. 远程文件访问输入固定使用 `rootId + relativePath`；远程公开契约不得接受 `absolutePath`。
8. `/v1/remote/*` 的公开响应不得泄露服务器绝对路径。
9. 远程只读 HTTP 入口必须保持 same-origin 发布语义，供桌面壳或后续窄屏壳统一消费。
10. `GET /v1/remote/files/content` 必须支持 `Range` / `206 Partial Content` / `Accept-Ranges: bytes`，可被浏览器原生媒体元素直接消费。
11. `GET /v1/remote/faces/crops/:faceId` 必须要求 `rootId` 查询参数，并验证该 `faceId` 对应资源仍属于所请求 root 的授权范围。
12. `rememberDeviceLabel` 只允许作为 remembered device 的用户可读标签元数据，不得改变鉴权语义；留空时必须由服务端回退到自动生成的人类可读设备名。
13. 远程共享收藏接口固定只接受 `rootId + path`；`path` 允许为空字符串表示根目录收藏，但不得接受 `absolutePath`。
14. `GET /v1/remote/favorites` 的公开响应固定为最小 DTO `Array<{ rootId, path, favoritedAtMs }>`，不得返回服务器绝对路径、本机缓存 `rootId` 或其他内部定位字段。

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

### Gateway 进程环境与 WSL 恢复（Gateway Process Env & WSL Recovery）

1. Gateway 启动前必须可选读取全局环境文件 `~/.fauplay/global/.env`；文件缺失时静默跳过，语法非法时必须以配置错误失败启动并标注文件路径。
2. 同名环境变量优先级固定为：`servers.<name>.env` > `~/.fauplay/global/.env` > 启动 Gateway 的 shell 环境变量。
3. `~/.fauplay/global/.env` 属于 app-owned 进程环境层，只用于 Gateway 与其子进程的环境变量注入，不替代 `src/config/*.json` 与 `tools/mcp/<tool>/config.json` 的文件型配置职责。
4. 当经 Gateway 发起的路径型工具调用或 Gateway 自身文件访问在 `/mnt/<drive>/...` 命中 `No such device` 时，Gateway 必须尝试执行 `sudo -S mount -t drvfs <DRIVE>: /mnt/<drive>` 并仅重试一次。
5. 上述自动重挂载仅使用进程环境变量 `SUDO_PASSWORD`；缺失、密码错误或挂载超时时必须快速失败并返回可读错误，不得拖延为前端 `MCP_CLIENT_TIMEOUT`。
6. Gateway 级 WSL 自动恢复属于横切运行时保障，不改变现有 MCP/HTTP 接口的 schema、工具名或请求字段。

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

### `tools/call` 结果投射扩展（Tool Result Projection Extension）

用途：允许具体工具调用结果把一组文件投射到工作区底部结果面板中的投射标签，而不修改 `tools/list` 静态结构。

约束：

1. `tools/call.result` 可选携带顶层字段 `projection`。
2. `projection` 只绑定到“该次具体结果项”，不得被解释为工具级静态能力声明。
3. `projection.entry` 取值固定为 `auto | manual`。
4. `projection.ordering.mode` 取值固定为 `listed | group_contiguous | mixed`。
5. `projection.files[]` 最小字段至少应包含：
   - `absolutePath`
   - `name`
   - `previewKind`
   - `displayPath`
   - `sourceType`
6. 不支持结果投射的客户端必须安全忽略 `projection` 字段，而不是把整条结果判定为协议错误。
7. `projection` 的工作区呈现、底部结果面板与活动表面语义归属 [`111-local-file-browser/spec.md`](./111-local-file-browser/spec.md)。

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
4. `/v1/remote/*` 必须把鉴权、allowlist root 与路径越界校验视为入口层强约束，而不是依赖前端自觉传参。
5. 协议层必须为鉴权失败、会话缺失或非法会话提供统一且最小化的错误语义；更高层的安全治理、信任边界、暴露面与 session 生命周期规则由 [`../006-security/spec.md`](../006-security/spec.md) 定义。

## 非目标

1. 不定义 UI 组件与交互设计。
2. 不定义网关内部扩展实现细节（如插件加载机制）。
3. 不定义任务拆解、排期和里程碑。
4. 不要求把现有 legacy `/v1/files/*`、`/v1/faces/*` 或 `/v1/mcp` 自动升级为 LAN 安全入口。

## 关联主题

- 上游基线：`000-foundation`
- 安全基线：`006-security`
- 架构边界：`001-architecture`
- 交互规范：`003-ui-ux`
- 插件运行时交互：`105-plugin-runtime-interaction`
- 触控优先紧凑远程只读工作区：`126-touch-first-compact-remote-readonly-workspace`
