# Runtime Config Reference 运行时配置参考

## 1. 目标

1. 为 app-owned 与 tool-owned 运行时配置提供清晰路径矩阵。
2. 明确各配置域的所有权与作用域：default、global、root。
3. 收敛旧 `*.local.json` 路径，避免兼容分叉。

## 2. 统一路径矩阵

1. App 默认配置：`src/config/<domain>.json`
2. Tool 默认配置：`tools/mcp/<tool>/config.json`
3. App 全局配置：`~/.fauplay/global/<domain>.json`
4. App 全局进程环境：`~/.fauplay/global/.env`
5. Root 配置：`<root>/.fauplay/<domain>.json`
6. 全局数据库：`~/.fauplay/global/faudb.sqlite`

解析顺序：

1. App-owned 域先读 `src/config/<domain>.json`
2. 再用 `~/.fauplay/global/<domain>.json` 做浅覆盖
3. 仅对显式 root-scoped 的 app-owned 域，再用 `<root>/.fauplay/<domain>.json` 做浅覆盖
4. Gateway 进程环境额外从 `~/.fauplay/global/.env` 注入，优先级为 `servers.<name>.env` > `~/.fauplay/global/.env` > shell env
5. Tool-owned 域默认只读 `tools/mcp/<tool>/config.json`
6. Tool-owned 域如需覆盖，必须显式改写 MCP server `args/env/command/cwd`，或独立运行时显式传 `--config`

## 3. 作用域表

| domain | owner | default | global | root | 备注 |
| --- | --- | --- | --- | --- | --- |
| `mcp` | app | `src/config/mcp.json` | yes | no | Gateway 启动期读取；`servers` 按 server key 合并，server 字段浅覆盖 |
| `remote-access` | app | `src/config/remote-access.json` | yes | no | LAN 只读入口配置；`enabled + rootSource + roots[]` 进入 JSON，登录交换 token 固定从 `~/.fauplay/global/.env` 的 `FAUPLAY_REMOTE_ACCESS_TOKEN` 读取；自动发布 roots 与远程共享收藏属于 Gateway 私有状态，不进入 JSON |
| `shortcuts` | app | `src/config/shortcuts.json` | yes | yes | 快捷键默认真源；按 action 级整项替换；global 由 Gateway 只读接口读取，root 由前端基于当前 root 句柄读取 |
| `gateway-env` | app | none | `~/.fauplay/global/.env` | no | 仅注入 Gateway 与 MCP 子进程环境变量；优先级低于 `servers.<name>.env`，高于 shell env |
| `local-data` | tool | `tools/mcp/local-data/config.json` | no | no | Gateway 数据链默认读取工具目录配置，不自动叠加全局 JSON |
| `video-same-duration` | tool | `tools/mcp/video-same-duration/config.json` | no | no | 支持显式 `--config`，默认读取工具目录配置 |
| `timm-classifier` | tool | `tools/mcp/timm-classifier/config.json` | no | no | 支持显式 `--config`，默认读取工具目录配置 |
| `vision-face` | tool | `tools/mcp/vision-face/config.json` | no | no | 支持显式 `--config`，默认读取工具目录配置 |
| `annotation` | app | `src/config/annotation.json` | yes | yes | 预留 root-scoped 域，适合当前浏览根语义 |

## 4. 查找约束

1. 配置查找必须按“精确文件路径”执行，不得递归扫描整个 `.fauplay/` 目录。
2. 当 `root=~` 时：
   - root 级文件：`~/.fauplay/<domain>.json`
   - 全局文件：`~/.fauplay/global/<domain>.json`
3. `~/.fauplay/global/.env` 只作为 Gateway 进程环境文件读取，不参与 `src/config/<domain>.json` 或 tool-owned `config.json` 的字段级覆盖。
4. `remote-access` 虽属 app-owned 域，但其 secret 固定走 `~/.fauplay/global/.env`，不得写入 `remote-access.json`。
5. Tool-owned 配置不得自动递归或隐式探测 `~/.fauplay/global/<domain>.json`。
6. `<root>/.fauplay/**` 必须继续从媒体浏览、索引与维护链路中排除。
7. 项目目录下 `.fauplay/` 只表示“该项目目录被当作 root 时”的本地目录，不再承载 repo 发布默认值。
8. `remote-access.rootSource` 缺省值固定为 `manual`；当取值为 `local-browser-sync` 时，远程 roots 真源切换为 Gateway 私有持久化文件 `~/.fauplay/global/remote-published-roots.v1.json`，而不是浏览器本地缓存或公开 JSON 配置链。
9. 远程共享收藏固定由 Gateway 私有持久化文件 `~/.fauplay/global/remote-shared-favorites.v1.json` 管理，不属于 app-owned 或 tool-owned 配置域。

## 5. 迁移约束

1. 旧 `${HOME}/.fauplay/faudb.global.sqlite` 迁移到 `${HOME}/.fauplay/global/faudb.sqlite`；若新路径已存在，则新路径为唯一权威。
2. 旧 `.fauplay/mcp.json` 迁移为 `src/config/mcp.json`。
3. `src/config/local-data.json`、`video-same-duration.json`、`timm-classifier.json`、`vision-face.json` 回迁为各自 `tools/mcp/<tool>/config.json`。
4. 旧 `~/.fauplay/global/local-data.json`、`video-same-duration.json`、`timm-classifier.json`、`vision-face.json` 退役；系统不再自动读取。
5. 旧 `.fauplay/mcp.local.json` 与 `config.local.json` 不再读取；用户如需 Host 级覆盖，应改写到 `~/.fauplay/global/mcp.json`。
