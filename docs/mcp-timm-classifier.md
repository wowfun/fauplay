# MCP Timm Classifier

本文档说明如何在 Fauplay 中使用 `timm` 图像分类 MCP 插件。

## 1. 文件位置

- MCP server 脚本：`tools/mcp/timm-classifier/server.py`
- 默认 MCP 注册配置：`src/config/mcp.json`
- 全局 MCP 覆盖：`~/.fauplay/global/mcp.json`
- 默认模型配置文件：`tools/mcp/timm-classifier/config.json`

## 2. Python 依赖

在项目环境安装以下依赖：

```bash
pip install torch transformers pillow
```

Fauplay 默认 MCP 注册会使用项目内的 `.venv/bin/python` 启动 `timm-classifier`，这样可以避免误用系统 `python3` 导致 `torch` 等依赖缺失。

## 3. 模型配置

默认配置随工具一起发布在 `tools/mcp/timm-classifier/config.json`：

```json
{
  "modelDir": "/mnt/d/Projects/fau/models/vision/eva02_base_patch14_448.mim_in22k_ft_in22k_in1k-fau",
  "device": "auto",
  "batch_size": 64
}
```

说明：

1. 当前插件使用 HuggingFace `ImageClassificationPipeline`，`modelDir` 必须是可直接加载的图像分类模型目录。
2. 目录至少应包含 `config.json` 与模型权重（如 `model.safetensors`），并建议提供图像预处理配置（如 `preprocessor_config.json`）。
3. `device=auto` 表示优先使用 CUDA，不可用时回退 CPU。
4. `batch_size` 仅用于 `ml.classifyBatch`，默认值为 `64`。
5. 未显式传入 `--config` 时，工具默认读取同目录 `config.json`；显式传入自定义 `--config` 时只读取该文件。

如需在 Fauplay 中做机器私有覆盖，可在 `~/.fauplay/global/mcp.json` 中覆盖该 server 的 `args`：

```json
{
  "servers": {
    "timm-classifier": {
      "args": [
        "tools/mcp/timm-classifier/server.py",
        "--config",
        "/abs/path/to/timm-classifier.local.json"
      ]
    }
  }
}
```

## 4. 启动网关

```bash
npm run gateway
```

## 5. MCP 验证

按生命周期验证：

```bash
# initialize
curl -sD /tmp/fauplay-init.headers -o /tmp/fauplay-init.body -X POST http://127.0.0.1:3210/v1/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-05","capabilities":{},"clientInfo":{"name":"fauplay-smoke","version":"0.0.0"}}}'

sid=$(grep -i '^mcp-session-id:' /tmp/fauplay-init.headers | head -n1 | cut -d' ' -f2 | tr -d '\r')

# notifications/initialized
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

预期在 `tools/list` 中看到：

- `ml.classifyImage`
- `ml.classifyBatch`

## 6. 调用示例

单图：

```bash
curl -s -X POST http://127.0.0.1:3210/v1/mcp \
  -H 'Content-Type: application/json' \
  -H "mcp-session-id: $sid" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"ml.classifyImage",
      "arguments":{
        "rootPath":"/mnt/d/Media",
        "relativePath":"albums/a.jpg",
        "topK":5,
        "minScore":0.0
      }
    }
  }'
```

批量：

```bash
curl -s -X POST http://127.0.0.1:3210/v1/mcp \
  -H 'Content-Type: application/json' \
  -H "mcp-session-id: $sid" \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"ml.classifyBatch",
      "arguments":{
        "rootPath":"/mnt/d/Media",
        "relativePaths":["albums/a.jpg","albums/b.jpg"],
        "topK":5,
        "minScore":0.0
      }
    }
  }'
```

## 7. 输出说明

- `predictions` 项结构为 `{ "label": string, "score": number }`（不包含 `index`）。

## 8. 测试样本

- 插件集成测试样本：`tools/mcp/timm-classifier/tests/fixtures/img1.jpg`
