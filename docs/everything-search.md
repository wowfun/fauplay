# Everything / ES 使用指引

本文档基于 Everything / ES 官方文档整理，聚焦：

1. `Everything64.exe`（GUI/CLI 参数）常用搜索。
2. `es.exe`（Everything 命令行接口）在脚本与终端中的稳定用法。
3. 视频时长相关搜索（`video:` + `length:`）与常见坑位。

## 1. 前置条件

1. 已安装并运行 Everything 1.5（示例路径：`/mnt/c/Program Files/Everything 1.5a/Everything64.exe`）。
2. 使用 ES 时，Everything 进程必须可被 IPC 访问（同用户会话，实例名一致）。
3. 本项目内 ES 路径（默认）：
   - `tools/mcp/video-same-duration/es.exe`

## 2. Everything64.exe 基础用法

Everything 官方命令行选项文档支持：

- `-s` / `-search`：设置搜索表达式
- `-p` / `-path`：按路径搜索
- `-sort <name>`：设置排序

示例（按大小降序，执行视频时长条件搜索）：

```bash
"/mnt/c/Program Files/Everything 1.5a/Everything64.exe" \
  -sort size-descending \
  -s '"D:\Projects\fauplay\_local\test_root" video: length:<30s;>8m'
```

说明：

- `video:` 是 Everything 搜索宏（视频文件）。
- `length:` 是视频/音频时长属性（Length，单位为秒，支持比较与区间语法）。

## 3. ES 基础用法

ES 用法（官方）：

```bash
es.exe [options] search text
```

常用参数：

- `-instance <name>`：连接指定 Everything 实例（例如 `1.5a`）
- `-path <path>`：限制搜索路径（搜索该路径下子目录与文件）
- `-parent <path>`：仅搜索指定父路径，不递归
- `-n` / `-count <count>`：限制返回条数
- `-sort <name[-ascending|-descending]>`：排序（可用属性名）
- `-double-quote`：结果路径用双引号包裹
- `-h` / `-help`：查看帮助

示例（推荐写法）：

```bash
tools/mcp/video-same-duration/es.exe \
  -instance 1.5a \
  -path "D:\Projects\fauplay\_local\test_root" \
  "video:" \
  "length:<30s;>8m" \
  -double-quote \
  -sort size-descending \
  -length -size
```

## 4. 时长搜索语法

Everything 函数语法支持：

- `function:value`
- `function:<value` / `<=value` / `>value` / `>=value`
- `function:start..end`

用于视频时长时，常见写法：

```text
length:00:10
length:>5m
length:>=9s length:<=11s
length:<30s;>8m
```

## 5. WSL / Bash 常见坑

1. 必须给包含 `>` `<` 的查询加引号  
   否则会被 shell 当成重定向。

```bash
# 正确
tools/mcp/video-same-duration/es.exe "length:>5m"

# 错误（> 会被 shell 吞掉）
tools/mcp/video-same-duration/es.exe length:>5m
```

2. 路径里有空格必须加引号  
   例如 `"/mnt/c/Program Files/Everything 1.5a/Everything64.exe"`。

3. ES 连接实例不一致会报 IPC 错误  
   建议显式传 `-instance 1.5a`。

4. 中文路径乱码  
   ES 在不同终端/代码页下可能出现编码不一致。可按“原始字节 + UTF-8/GBK 自动判定”处理。

## 6. 常见报错排查

### 6.1 `Error 8: Everything IPC not found`

检查顺序：

1. Everything 是否正在运行。
2. ES 的 `-instance` 是否匹配当前实例（例如 `1.5a`）。
3. 是否跨权限运行（Everything 管理员启动而终端非管理员，或反之）。

### 6.2 搜索结果为空但预期应命中

1. 检查是否忘记给 `length:>...` 加引号。
2. 检查路径过滤是否过窄（`-path` / `-parent`）。
3. 检查是否使用了错误实例（索引库不同）。

## 7. 参考链接

- Everything CLI 选项：<https://www.voidtools.com/support/everything/command_line_options/>
- Everything 搜索语法：<https://voidtools.com/support/everything/searching/>
- ES 官方帖（含 1.5 变化、参数说明）：<https://www.voidtools.com/forum/viewtopic.php?t=5762#1.5>
- Properties（Length 等属性说明）：<https://www.voidtools.com/forum/viewtopic.php?f=12&t=9788#everything_properties>
