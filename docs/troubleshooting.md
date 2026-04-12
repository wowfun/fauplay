# Fauplay Troubleshooting

本文档记录 Fauplay 常见问题与排查步骤。

## 1) “在文件资源管理器中显示”失败

### 现象

- 点击“在文件资源管理器中显示”后失败
- 网关日志出现类似错误：
  - `MZ...`
  - `No such device`
  - `Syntax error: newline unexpected`

### 原因

WSL 与 Windows 的 interop 未启用，`explorer.exe` 被当作 Linux 可执行文件处理。

### 解决

1. 在 WSL 中检查 `/etc/wsl.conf`：

```ini
[interop]
enabled=true
appendWindowsPath=true
```

2. 在 Windows PowerShell / CMD 中执行：

```bash
wsl --shutdown
```

3. 重开 WSL，验证：

```bash
explorer.exe .
```

4. 重新启动网关：

```bash
npm run gateway
```

## 1.1) 网关端口被占用（`EADDRINUSE`）

### 现象

- 启动 `npm run gateway` 时报错：`listen EADDRINUSE: address already in use 127.0.0.1:3210`
- 或 `curl /v1/health` 返回非网关响应（例如旧 helper 返回 `Not found`）
- 或 `POST /v1/mcp` 的 `tools/list` 返回 `-32600`（说明未完成 MCP 初始化生命周期）
- 或 `POST /v1/mcp` 的 `tools/list` 返回 404/非 JSON-RPC 响应（说明你连到的是旧服务）

### 原因

- 本机已有其他进程占用 `3210` 端口（常见于旧版 helper 或重复启动实例）。

### 解决

1. 检查占用进程：

```bash
ss -ltnp | rg 3210
```

2. 结束旧进程后重启：

```bash
kill <PID>
npm run gateway
```

3. 验证 MCP 路由（按生命周期顺序）：

```bash
# health
curl -s http://127.0.0.1:3210/v1/health

# initialize
curl -sD /tmp/fauplay-init.headers -o /tmp/fauplay-init.body -X POST http://127.0.0.1:3210/v1/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-05","capabilities":{},"clientInfo":{"name":"fauplay-smoke","version":"0.0.0"}}}'
cat /tmp/fauplay-init.body
sid=$(grep -i '^mcp-session-id:' /tmp/fauplay-init.headers | head -n1 | cut -d' ' -f2 | tr -d '\r')

# initialized notification (expect HTTP 204)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3210/v1/mcp \
  -H 'Content-Type: application/json' \
  -H "mcp-session-id: $sid" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'

# tools/list
curl -s -X POST http://127.0.0.1:3210/v1/mcp \
  -H 'Content-Type: application/json' \
  -H "mcp-session-id: $sid" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## 1.2) MCP Server 未加载（`mcp.json`）

### 现象

- 启动网关后预期工具未出现在 `tools/list` 中
- 网关日志提示 `Skip MCP server ...`

### 原因

- `src/config/mcp.json` 语法错误或结构错误
- `~/.fauplay/global/mcp.json` 语法错误或结构错误
- `servers.<name>.type` 不是 `stdio`
- `stdio` 条目的 `command` 缺失或为空
- `servers.<name>.disabled` 被设置为 `true`

### 解决

1. 先检查 repo 默认配置与全局覆盖的 JSON 语法：

```bash
cat src/config/mcp.json
cat ~/.fauplay/global/mcp.json
```

2. 确认条目为可执行的 `stdio` server：

```json
{
  "servers": {
    "reveal-cli": {
      "type": "stdio",
      "command": "node",
      "args": ["tools/mcp/reveal-cli/server.mjs"]
    },
    "my-server": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```

3. 重启网关并重新执行 `tools/list` 验证。

## 1.3) 相同时长插件报 `No such device`（WSL 盘符挂载失效）

### 现象

- `media.searchSameDurationVideos` 执行失败，报错类似：
  - `Failed to probe video duration: ... No such device`
  - 错误码 `MCP_TOOL_CALL_FAILED`

### 原因

- WSL 下 `/mnt/<drive>` 的 `drvfs` 挂载失效（常见于移动硬盘、休眠恢复后）。

### 机制

- 插件在探测视频时长/文件大小阶段，若命中 `/mnt/<drive>` + `No such device`，会自动执行：

```bash
sudo -S mount -t drvfs <DRIVE>: /mnt/<drive>
```

- 挂载成功后自动重试一次。
- 该机制只读取 `SUDO_PASSWORD`，不支持 `sudo_password`。

### 配置

把 `SUDO_PASSWORD` 写到 `~/.fauplay/global/mcp.json`。`servers.<name>` 按 server key 合并，server 内字段做浅覆盖，因此只需覆盖 `env`：

```json
{
  "servers": {
    "video-same-duration": {
      "env": {
        "SUDO_PASSWORD": "<your_sudo_password>"
      }
    }
  }
}
```

## 2) 选择文件夹后无法进入子目录

### 现象

- 点击目录报错：`current.getDirectory is not a function`

### 原因

使用了旧方法名，标准 API 应为 `getDirectoryHandle`。

### 解决

- 确认代码使用 `getDirectoryHandle(...)` 而不是 `getDirectory(...)`。

## 3) 子目录中文件无缩略图/无法预览

### 现象

- 进入子目录后，文件不出缩略图、无法预览或双击无效

### 原因

文件 `path` 未带父目录前缀，读取时仍按根目录解析。

### 解决

- 确认目录切换后写入列表时，`path` 已拼接当前目录前缀。

## 4) 网格区域点击或键盘导航时闪烁

### 排查点

1. 是否让顶层状态驱动整个网格重渲（例如把选中态放在 `App` 并向下透传）  
2. 是否在网格中对选中态使用了高频 `setState`（键盘移动时每步都触发重渲）  
3. 选中高亮是否依赖 DOM 属性（`data-grid-selected`）而非 React 选中状态

### 建议

- 选择逻辑保留在 `FileGridViewport` 内部，不向 `App` 透传 `selectedPath`。
- 使用 `ref + DOM attribute` 方式更新选中态：仅更新前后两个卡片的 `data-grid-selected`，避免整网格重渲。
- 卡片样式通过 `data-[grid-selected=true]:...` 控制，保证失焦后仍保留高亮且不闪烁。

## 5) 预览窗格媒体高度超出可见区域

### 现象

- 右侧预览窗格中，图片/视频底部超出可见范围
- 拖拽预览窗格宽度后，媒体显示比例异常

### 原因

- 媒体元素只约束了宽度，未限制最大高度
- 复杂布局（工具栏 + 状态栏 + 预览头部）下，`100vh` 或纯宽度填充容易导致高度计算偏大

### 解决

- 在预览媒体上使用等比缩放：`object-contain`
- 同时限制最大高度为 `85vh`，并保留最大宽度约束（`max-w-full`）
- 建议样式：
  - 图片：`max-h-[85vh] max-w-full object-contain`
  - 视频：`max-h-[85vh] max-w-full object-contain`

## 6) 随机遍历模式下无法关闭预览

### 现象

- 在“随机”遍历模式下点击关闭预览（或按 `Esc`）后，预览面板立即被重新打开。

### 原因

- 随机队列同步逻辑在无活动预览目标时会回退到默认媒体并强制打开面板，覆盖了用户的关闭动作。

### 解决

- 仅在预览已打开（侧栏或全屏）时执行随机队列同步逻辑。
- 当预览已完全关闭时，随机状态仅保留内存，不主动触发 UI 重开。

## 7) Windows / WSL 下 `https://localhost` 正常，但局域网 IP 无法访问 HTTPS 开发站点

### 现象

- Windows 本机可以打开 `https://localhost:5173`
- 手机访问 `https://<局域网IP>:5173` 超时或失败
- `Test-NetConnection <局域网IP> -Port 5173` 失败

### 排查顺序

1. 先确认本地 `HTTPS` 联调链路本身是通的：

```bash
npm run gateway
npm run dev:https
```

2. 先在 Windows 本机浏览器确认 `https://localhost:5173` 可正常打开，并且证书已受信任。
3. 再用手机直接实测 `https://<局域网IP>:5173`，不要只依赖主机上的 `Test-NetConnection` 结果判断成败。

### WSL mirrored networking 注意点

如果你的 WSL 使用 mirrored networking，`wsl hostname -I` 可能会直接显示宿主机的局域网 IP。此时优先检查 WSL 的 Hyper-V 防火墙，不要先叠加 `portproxy`。

检查当前 WSL VM 防火墙状态：

```powershell
$wslId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
Get-NetFirewallHyperVVMSetting -PolicyStore ActiveStore -Name $wslId
```

如果需要为本地 HTTPS 开发站点开放 `5173`，优先增加显式端口规则：

```powershell
New-NetFirewallHyperVRule `
  -Name FauplayHttps5173 `
  -DisplayName "Fauplay HTTPS Dev 5173" `
  -Direction Inbound `
  -VMCreatorId $wslId `
  -Protocol TCP `
  -LocalPorts 5173
```

不建议在这种 mirrored networking 场景里把 `DefaultInboundAction` 长期改成 `Allow`，也不建议把 `netsh interface portproxy` 当成首选方案。

### 何时需要 `hostAddressLoopback`

如果手机已经能访问，就不必继续为了让 Windows 自己通过“自己的局域网 IP”访问成功而叠加更多代理层。

只有当你明确需要 Windows 宿主机通过自身局域网 IP 回连 WSL 服务时，再考虑在 `%UserProfile%\\.wslconfig` 中启用：

```ini
[wsl2]
networkingMode=mirrored
hostAddressLoopback=true
firewall=true
```

修改后执行：

```powershell
wsl --shutdown
```

然后重新启动 `npm run gateway` 与 `npm run dev:https`。

### 清理临时规则

如果你为了排查额外加过规则，且后续不再需要手机访问本地 HTTPS 开发站点，记得清理：

```powershell
Remove-NetFirewallHyperVRule -Name FauplayHttps5173
netsh interface portproxy delete v4tov4 listenaddress=<局域网IP> listenport=5173
```

如果手机访问已经正常，不要继续为了让某条本机自测命令通过而保留多余的 `portproxy` 配置。

## 7) 目录中有图片但显示为空文件夹（前导空格文件名）

### 现象

- 目录中实际有图片文件，但应用显示“没有文件”或目录角标显示 `0`。
- 常见于文件名带前导空格（例如 ` (1).jpg`、` (10).jpg`）。
- 把其中一个文件改名为无前导空格后，该文件可被识别。

### 原因

- 当前运行环境下，File System Access API 目录枚举层在“前导空格文件名”场景可能返回不完整结果。
- 该问题属于环境相关枚举异常，不是扩展名过滤规则本身导致。

### 临时规避

- 批量去除前导空格文件名（例如 ` (1).jpg` -> `(1).jpg` 或 `1.jpg`）。
- 对存量数据，优先避免创建带前导空格的新文件名。

### 长期方案（待排期）

- 将目录枚举迁移到 Gateway/Node 路径（`fs.readdir`），避免依赖浏览器枚举层。
- 前端保留现有预览链路，目录列表与计数优先采用后端枚举结果。

### 状态

- `Open`（遗留问题，未在应用层最终修复）
- 首次记录：`2026-03-09`
- 处理策略：`Deferred`（先记录，后续按网关目录枚举能力专题处理）
