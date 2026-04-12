# Fauplay 远程连接指引

本文档面向想在同一局域网内，从桌面浏览器或手机浏览器访问 Fauplay 远程只读服务的使用者。

如果你要解决的是“本机如何跑出一个可用的 `HTTPS` 联调环境”，请看 [`docs/https-dev.md`](./https-dev.md)。如果连接过程中遇到平台或网络问题，请看 [`docs/troubleshooting.md`](./troubleshooting.md)。

## 1. 连接模型

- Fauplay 的远程访问固定为局域网内的同源 `HTTPS` 只读访问。
- 浏览器访问的是同一个 origin 下的前端页面与 `/v1/remote/*` 接口。
- 登录阶段使用一次性 `Bearer Token`；登录成功后，运行态鉴权改为同源 session cookie。
- 用户可在登录时显式选择“记住此设备”；启用后，服务端会额外签发 remember-device cookie，用于后续自动恢复 session，但浏览器不会持久化原始 token。
- 远程模式固定为只读，不提供删除、重命名、标注写入、人物写操作或插件工作台。
- 启动页的“选择本地文件夹”仍然表示“浏览当前浏览器所在设备的本地目录”，和远程模式是两条独立入口。
- 当前手机浏览器的工作区目标形态固定为“触控优先 + 紧凑视口 + 远程只读”：文件网格为主、点击文件直达全屏预览、次级能力通过临时面板进入。

## 2. 服务端准备

### 2.1 配置远程 roots

Fauplay 的远程 roots 通过 `remote-access` 配置声明。仓库内默认文件位于 `src/config/remote-access.json`，实际部署时通常通过全局配置覆盖：

```text
~/.fauplay/global/remote-access.json
```

最小示例：

```json
{
  "enabled": true,
  "rootSource": "manual",
  "roots": [
    {
      "id": "media",
      "label": "媒体库",
      "path": "/absolute/path/to/media"
    }
  ]
}
```

约束：

- `enabled` 必须为 `true` 才会对外提供远程只读能力。
- `rootSource` 缺省值为 `manual`。
- 当 `rootSource='manual'` 时，`roots[]` 中的 `id` 用于 API 定位，`label` 用于前端展示，`path` 必须指向 Fauplay 所在机器本地可读目录。
- 当 `rootSource='local-browser-sync'` 时，不再手写 `roots[]`；远程 roots 真源改为服务端私有状态文件 `~/.fauplay/global/remote-published-roots.v1.json`，它由本机 full-access 浏览器自动同步生成。
- `local-browser-sync` 要求服务机至少打开过一次本机 full-access，并且对应 cached root 已完成 `rootPath` 绑定；未绑定的 cached root 不会被远程发布。
- 远程接口不会把这些绝对路径暴露给浏览器。

### 2.2 配置登录 token

远程登录 token 不进入 JSON，统一放在：

```text
~/.fauplay/global/.env
```

示例：

```dotenv
FAUPLAY_REMOTE_ACCESS_TOKEN=replace-with-a-strong-token
```

可选地，也可以在同一个 `~/.fauplay/global/.env` 中调整当前实现的远程安全与预算参数：

```dotenv
# 远程会话生命周期
FAUPLAY_REMOTE_SESSION_ABSOLUTE_TTL_MS=43200000
FAUPLAY_REMOTE_SESSION_IDLE_TTL_MS=1800000

# 登录失败限速
FAUPLAY_REMOTE_LOGIN_FAILURE_WINDOW_MS=600000
FAUPLAY_REMOTE_LOGIN_MAX_FAILURES=8
FAUPLAY_REMOTE_LOGIN_BLOCK_DURATION_MS=600000

# 高成本入口预算
FAUPLAY_REMOTE_FLATTEN_VIEW_MAX_FILES=5000
FAUPLAY_REMOTE_FLATTEN_VIEW_MAX_DIRECTORIES=1000
FAUPLAY_REMOTE_THUMBNAIL_SOURCE_MAX_BYTES=33554432
FAUPLAY_REMOTE_MAX_RANGE_BYTES=16777216
```

如果不配置，当前实现默认使用上面的数值。

### 2.3 启动 Gateway

```bash
npm run gateway
```

如果 `remote-access.enabled=false`、roots 配置非法，或 `FAUPLAY_REMOTE_ACCESS_TOKEN` 缺失，远程入口会处于不可用状态。

补充说明：

- 当前实现会在后续远程请求中检测 `~/.fauplay/global/remote-access.json` 与 `~/.fauplay/global/.env` 是否发生变化。
- 一旦检测到远程配置或 token 发生变化，既有远程 session 与 remembered device 都会失效，浏览器需要重新登录。
- Gateway 重启后，内存 session 会失效；如果当前浏览器之前启用了 remember-device，后续访问可由服务端自动补发新的 session。

## 3. 发布要求

Fauplay 的 Gateway 默认仍监听回环地址。要让局域网内其他设备访问，发布层必须满足以下条件：

- 使用外部反向代理终止 `HTTPS`。
- 将前端页面与 `/v1/remote/*` 发布在同一个 origin 下。
- 对 LAN 只公开 `/` 与 `/v1/remote/*`。
- 不要对 LAN 暴露 legacy `/v1/files/*`、legacy `/v1/faces/*`、`/v1/mcp` 等现有 loopback 面。

如果你当前只是想在开发机上验证 `Secure` cookie、原生图片/视频请求和手机访问链路，不必先搭正式反向代理，直接使用 [`docs/https-dev.md`](./https-dev.md) 中的本地 `HTTPS` 联调方案即可。

## 4. 浏览器连接流程

1. 在浏览器打开 Fauplay 的远程站点。
2. 在启动页选择“连接远程 Fauplay”。
3. 输入远程登录 token。
4. 如需降低后续重复输入频率，可勾选“记住此设备（30 天）”。
5. 勾选后可选填写“设备名”；留空时由服务端根据当前浏览器环境自动生成一个人类可读名称。
6. 登录成功后：
   - 如果服务端只配置了一个 root，页面可直接进入该 root。
   - 如果配置了多个 roots，页面会先展示 roots 列表供选择。
7. 进入远程工作区后，可继续执行目录浏览、搜索、排序、平铺视图、预览、标签过滤与人物只读浏览。
8. 远程收藏为服务端共享状态；同一远程服务上的多个浏览器设备会看到一致的收藏结果。
9. 需要退出远程模式时：
   - 使用顶部工具栏中的“断开/切换”返回启动页，只清当前 session。
   - 如需撤销当前浏览器上的持久登录态，使用“忘记此设备”。

运行态行为：

- 远程登录态由同源 session cookie 维持，可被同一浏览器的同源标签页复用。
- 当 remember-device 有效时，服务端可在 session 缺失或 Gateway 重启后自动补发新的 session cookie。
- 远程 session 不是永久有效；当前实现默认同时启用绝对过期和空闲过期。
- 当前默认值为：绝对过期 `12h`，空闲过期 `30min`；如有需要，可通过 `~/.fauplay/global/.env` 调整。
- 当前 remember-device 目标口径为 `30d`，且必须由用户显式勾选启用。
- 连续多次输入错误 token 时，登录接口会触发服务端限速或短时阻断。
- 任一远程请求返回 `401` 时，前端会清理当前远程工作区状态，并回到远程登录页。

### 4.1 本机 remembered-device 管理

- Fauplay 服务器本机的启动页可提供“管理已记住设备”入口，用于查看、重命名与撤销 remembered devices。
- 管理页只在本机 loopback/full-access 入口可见；远程浏览器与远程只读工作区不会显示该入口。
- 设备主显示名优先使用你填写的“设备名”；留空时回退为服务端生成的自动名称，例如 `Safari · iPhone`、`Chrome · Android`。
- 撤销 remembered device 会立即一并失效该设备关联的活动 session；之后该设备上的下一次远程请求会回到登录页。
- 管理页返回的是最小化设备信息，不会显示 remembered-device cookie 原值、原始 token 或完整 `User-Agent`。

## 5. 手机访问

手机浏览器访问时，关注这几点：

- 手机与 Fauplay 所在设备必须在同一局域网内。
- 手机访问的必须是同一个 `HTTPS` 站点，而不是 `http://127.0.0.1` 或桌面浏览器专用的本地回环地址。
- 如果站点使用自签发证书，手机端需要先导入并信任相应 CA。
- 手机端不需要 File System Access；远程模式使用的是 Fauplay 服务器上的只读数据面。

远程媒体链路：

- 图片、缩略图、视频和人物 face crop 走浏览器原生请求。
- 视频预览依赖服务端 `Range` 支持，用于首开、拖动与续播。
- 人物 face crop 同样受当前 remote root 作用域保护；跨 root 或越权请求会失败。
- 当平铺遍历、缩略图源文件或超大媒体 `Range` 请求超出服务端预算时，接口会返回受控失败，而不是无限等待。
- 如果文件列表可见但缩略图或预览失败，优先检查 `HTTPS`、登录态与远程媒体接口是否走同源请求。

## 6. 安全与行为边界

- 登录 token 只用于交换会话，不应写入浏览器长期存储。
- remember-device 仅保存服务端可撤销的设备级登录态；服务端持久化层只保存最小化摘要，不保存可直接复用的原始 token。
- 远程接口只接受 `rootId + relativePath`，不接受浏览器传入绝对路径。
- 服务端会拒绝绝对路径、空路径、`..` 和 realpath 越界目标。
- 通过 `faceId` 这类内部标识访问的衍生资源，同样不能绕过 root 作用域校验。
- 浏览器本地收藏、最近访问等状态会按远程服务 origin 隔离；token、cookie 和服务器绝对路径不应进入本地持久化状态。
- `remote-readonly` 下的收藏真源不再是浏览器 localStorage，而是服务端共享收藏状态；本机 `full-access` 收藏只会在 loopback-only 自动同步时作为播种输入。
- 远程模式保留浏览与预览能力，但隐藏写操作、回收站、插件工作台与人物 mutation UI。

## 7. 相关文档

- 本地 `HTTPS` 开发联调：[`docs/https-dev.md`](./https-dev.md)
- 常见问题排查：[`docs/troubleshooting.md`](./troubleshooting.md)
