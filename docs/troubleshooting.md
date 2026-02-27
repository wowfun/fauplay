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

4. 重新启动 helper：

```bash
npm run reveal-helper
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
2. 是否在网格中使用了高频 `setState` 触发整块重绘  
3. 是否把选中高亮改为 focus 驱动，减少 React 状态变更

### 建议

- 优先让网格选择逻辑在网格内部处理，并尽量使用焦点态而非全局选中态。

