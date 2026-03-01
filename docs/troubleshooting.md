# Fauplay Troubleshooting

本文档记录 Fauplay 常见问题与排查步骤。

## 1) “在文件资源管理器中显示”失败

### 现象

- 点击“在文件资源管理器中显示”后失败
- helper 日志出现类似错误：
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

4. 重新启动网关（兼容命令同名）：

```bash
npm run gateway
```

## 1.1) 网关端口被占用（`EADDRINUSE`）

### 现象

- 启动 `npm run gateway` 时报错：`listen EADDRINUSE: address already in use 127.0.0.1:3210`
- 或 `curl /v1/health` 返回非网关响应（例如旧 helper 返回 `Not found`）

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

- 选择逻辑保留在 `VirtualGrid` 内部，不向 `App` 透传 `selectedPath`。
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
