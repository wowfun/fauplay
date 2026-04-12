# 本地 HTTPS 开发联调

本页只用于开发者在本机或局域网内联调 `126 Touch-First Compact Remote-Readonly Workspace` 所依赖的同源 `HTTPS` 场景，不是生产部署指南，也不是远程连接总说明。

如果你要配置和使用真正的远程只读访问，请先看 [`docs/remote-connection.md`](./remote-connection.md)。如果你在 WSL / Windows / 手机访问过程中遇到网络或证书问题，请再看 [`docs/troubleshooting.md`](./troubleshooting.md)。

本页的目标是：

- 保持远程运行态继续使用 `Secure` session cookie
- 让桌面浏览器与手机浏览器都能通过本地开发环境验证远程登录、Roots 读取、图片/视频原生请求
- 避免 `https://` 页面直接访问 `http://127.0.0.1` 时的 mixed content

## 适用场景

当你需要下面这些能力时，使用本页：

- 在本地开发环境下保留 `Secure` session cookie 约束
- 在 `https://localhost` 或 `https://<局域网IP>` 下验证远程登录与 roots 读取
- 在手机浏览器上联调远程图片、视频、缩略图与 face crop 的原生加载链路

如果你的目标是“给同一局域网的其他设备正式提供远程只读访问”，这不是最终发布方案；正式使用请回到 [`docs/remote-connection.md`](./remote-connection.md) 中的同源 `HTTPS` 发布要求。

## 方案概览

- `npm run dev:https:setup`
  - 生成本地开发用 CA 与服务器证书
  - 默认输出到 `.cache/dev-https/`
- `npm run dev:https`
  - 以 `HTTPS` 启动 Vite
  - 默认监听 `0.0.0.0`
  - dev-only 地将同源 `/v1/*` 代理到本机 loopback Gateway

说明：

- 这个 `/v1/*` 代理只属于本地联调便利能力，不代表生产 LAN 发布边界被放宽。
- 生产 LAN 场景仍然要求仅公开前端与 `/v1/remote/*`。

## 首次准备

1. 安装依赖。

```bash
npm install
```

2. 生成本地 CA 与服务器证书。

```bash
npm run dev:https:setup
```

3. 如果脚本未自动识别到你的局域网 IP，可手工补充。

```bash
npm run dev:https:setup -- --ip=192.168.1.23
```

也可以同时补充额外主机名：

```bash
npm run dev:https:setup -- --ip=192.168.1.23 --dns=fauplay-dev.local
```

## 启动方式

先启动 Gateway：

```bash
npm run gateway
```

再启动 HTTPS 前端：

```bash
npm run dev:https
```

如需自定义端口或 host，可把参数继续传给 Vite：

```bash
npm run dev:https -- --host 0.0.0.0 --port 5174
```

补充说明：

- 如果你刚修改了 `~/.fauplay/global/remote-access.json` 或 `~/.fauplay/global/.env`，当前远程 session 在下一次远程请求时会失效，浏览器需要重新登录。
- 如果你连续多次输入错误 token，当前实现会触发服务端限速或短时阻断；这属于预期安全行为。

## 手机联调

1. 先把本地 CA 导入到需要联调的设备并设为受信任证书。

证书路径：

```text
.cache/dev-https/ca-cert.crt
```

2. 确认桌面设备与手机在同一局域网。
3. 用手机浏览器打开：

```text
https://<你的局域网IP>:5173
```

若你自定义了端口，则替换成对应端口。

## 注意事项

- 如果手机仍然提示证书不受信任，优先检查是否导入并信任了 `ca-cert.crt`，以及服务器证书是否覆盖了当前访问 IP。
- 重新换网、换 IP 或增加新的访问地址后，建议重新执行一次 `npm run dev:https:setup`。
- 如果文件列表正常但人物 face crop 失败，优先确认当前仍在正确的 remote root 下；远程 `face crop` 当前要求带上 `rootId` 并通过 root 作用域校验。
- 如果 `flattenView`、缩略图或超大视频拖动请求被拒绝，先检查是否命中了服务端预算上界；这通常是受控失败，不是前端随机异常。
- 若只想验证远程只读链路，不需要在手机端开放本地浏览器的 File System Access 能力。
- dev 模式下同源代理了额外的 `/v1/*` 入口，仅用于本地联调便利；生产 LAN 发布面仍只能公开 `/` 与 `/v1/remote/*`。
- 如果你需要的是“如何配置远程 roots、token、发布入口和浏览器连接流程”，请改看 [`docs/remote-connection.md`](./remote-connection.md)。
