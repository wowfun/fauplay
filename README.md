# Fauplay

Fauplay 是一个本地优先（Local-First）的媒体 / 文件工作区，由浏览器前端、本地 Gateway 与 MCP 工具链组成。

## Features

- 在浏览器中选择根目录进行文件管理和浏览
- Gateway 支持集成工具进行能力扩展，已内置多个MCP工具，包括常见文件整理、标签管理、人物识别与管理等
- 最小运行（不启动 Gateway）时具备较完整的只读浏览体验
- 出于安全考虑，远程访问固定为同源 `HTTPS` + Token 的只读模式

## 快速开始

### 安装依赖

```bash
npm install
```

### 本地最小运行：体验核心文件浏览能力
本地开发 / 联调入口：

```bash
npm run dev
```

### 启动 Gateway：增强能力
部分工具仍需额外环境，例如 `.venv` 或 Everything。

```bash
npm run gateway
```

### 远程访问：只读模式
本地 HTTPS 联调入口；远程访问固定为同源 `HTTPS` + Token 的只读模式：

```bash
npm run dev:https:setup # 首次配置，生成本地 HTTPS 证书

npm run gateway
npm run dev:https
```

## Docs

- [快捷键](docs/shortcuts.md)
- [远程连接](docs/remote-connection.md)
- [本地 HTTPS 联调](docs/https-dev.md)
- [排障](docs/troubleshooting.md)

## 项目结构

主要目录：
- `src/`：前端工作区 / 预览 / 插件运行时
- `scripts/gateway/`：Gateway
- `tools/mcp/`：内置 MCP servers
