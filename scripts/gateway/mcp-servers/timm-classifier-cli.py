#!/usr/bin/env python3
import argparse
import inspect
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

MCP_PROTOCOL_VERSION = "2025-11-05"
SERVER_NAME = "fauplay-timm-classifier"
SERVER_VERSION = "0.2.0"

DEFAULT_TOP_K = 5
DEFAULT_MIN_SCORE = 0.0
DEFAULT_MAX_ITEMS = 256
MAX_TOP_K = 20
MAX_BATCH_ITEMS = 1024
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
WINDOWS_ABS_PATTERN = re.compile(r"^[a-zA-Z]:[\\/]")


class MCPError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def create_jsonrpc_error(code: int, message: str, data_code: str | None = None) -> dict:
    error = {"code": code, "message": message}
    if data_code:
        error["data"] = {"code": data_code}
    return error


def to_jsonrpc_error(error: Exception) -> dict:
    if isinstance(error, MCPError):
        if error.code == "MCP_INVALID_REQUEST":
            return create_jsonrpc_error(-32600, str(error), "MCP_INVALID_REQUEST")
        if error.code == "MCP_METHOD_NOT_FOUND":
            return create_jsonrpc_error(-32601, str(error), "MCP_METHOD_NOT_FOUND")
        if error.code == "MCP_INVALID_PARAMS":
            return create_jsonrpc_error(-32602, str(error), "MCP_INVALID_PARAMS")
        if error.code == "MCP_TOOL_NOT_FOUND":
            return create_jsonrpc_error(-32601, str(error), "MCP_TOOL_NOT_FOUND")
        return create_jsonrpc_error(-32000, str(error), error.code)

    return create_jsonrpc_error(-32000, str(error) or "Server error", "MCP_TOOL_CALL_FAILED")


def parse_jsonrpc_request(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise MCPError("MCP_INVALID_REQUEST", "Invalid JSON-RPC request payload")
    if payload.get("jsonrpc") != "2.0":
        raise MCPError("MCP_INVALID_REQUEST", 'jsonrpc must be "2.0"')

    method = payload.get("method")
    if not isinstance(method, str) or not method:
        raise MCPError("MCP_INVALID_REQUEST", "method is required")

    params = payload.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise MCPError("MCP_INVALID_REQUEST", "params must be an object")

    return {
        "id": payload.get("id"),
        "method": method,
        "params": params,
        "is_notification": "id" not in payload,
    }


def write_jsonrpc(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def is_windows_abs_path(path_str: str) -> bool:
    return bool(WINDOWS_ABS_PATTERN.match(path_str))


def normalize_root_path(raw_root_path: str) -> str:
    root_path = raw_root_path.strip()
    if os.name != "nt" and is_windows_abs_path(root_path):
        try:
            completed = subprocess.run(
                ["wslpath", "-u", root_path],
                check=True,
                capture_output=True,
                text=True,
            )
            converted = completed.stdout.strip()
            if converted:
                return converted
        except Exception:
            return root_path
    return root_path


def parse_top_k(value: object) -> int:
    if value is None:
        return DEFAULT_TOP_K
    if isinstance(value, bool) or not isinstance(value, int):
        raise MCPError("MCP_INVALID_PARAMS", "topK must be an integer")
    if value < 1 or value > MAX_TOP_K:
        raise MCPError("MCP_INVALID_PARAMS", f"topK must be in range [1, {MAX_TOP_K}]")
    return value


def parse_min_score(value: object) -> float:
    if value is None:
        return DEFAULT_MIN_SCORE
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MCPError("MCP_INVALID_PARAMS", "minScore must be a number")
    score = float(value)
    if score < 0.0 or score > 1.0:
        raise MCPError("MCP_INVALID_PARAMS", "minScore must be in range [0, 1]")
    return score


def parse_max_items(value: object) -> int:
    if value is None:
        return DEFAULT_MAX_ITEMS
    if isinstance(value, bool) or not isinstance(value, int):
        raise MCPError("MCP_INVALID_PARAMS", "maxItems must be an integer")
    if value < 1 or value > MAX_BATCH_ITEMS:
        raise MCPError("MCP_INVALID_PARAMS", f"maxItems must be in range [1, {MAX_BATCH_ITEMS}]")
    return value


def resolve_image_path(root_path: object, relative_path: object) -> Path:
    if not isinstance(root_path, str) or not root_path.strip():
        raise MCPError("MCP_INVALID_PARAMS", "rootPath is required")
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise MCPError("MCP_INVALID_PARAMS", "relativePath is required")

    normalized_relative = relative_path.replace("\\", "/")
    segments = [segment for segment in normalized_relative.split("/") if segment and segment != "."]
    if not segments:
        raise MCPError("MCP_INVALID_PARAMS", "relativePath is invalid")
    if any(segment == ".." for segment in segments):
        raise MCPError("MCP_INVALID_PARAMS", "relativePath contains unsafe segments")

    root_path_value = normalize_root_path(root_path)
    root = Path(root_path_value).expanduser()
    if not root.is_absolute():
        raise MCPError("MCP_INVALID_PARAMS", "rootPath must be an absolute path")

    root_resolved = root.resolve()
    target = root_resolved.joinpath(*segments).resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError as error:
        raise MCPError("MCP_INVALID_PARAMS", "relativePath escapes rootPath") from error

    if not target.exists() or not target.is_file():
        raise MCPError("MCP_INVALID_PARAMS", f"image file not found: {relative_path}")
    if target.suffix.lower() not in IMAGE_EXTENSIONS:
        raise MCPError("MCP_INVALID_PARAMS", f"unsupported image extension: {target.suffix}")

    return target


def strip_module_prefix(state_dict: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in state_dict.items():
        result[key[7:] if key.startswith("module.") else key] = value
    return result


def resolve_model_dir_path(config_dir: Path, model_dir_raw: str) -> Path:
    model_dir = Path(model_dir_raw)
    if not model_dir.is_absolute():
        model_dir = (config_dir / model_dir).resolve()
    else:
        model_dir = model_dir.resolve()
    return model_dir


def load_model_bundle_metadata(model_dir: Path) -> dict[str, Any]:
    config_path = model_dir / "config.json"
    weights_path = model_dir / "model.safetensors"

    if not config_path.exists() or not config_path.is_file():
        raise MCPError("MCP_TOOL_CALL_FAILED", f"model config not found: {config_path}")
    if not weights_path.exists() or not weights_path.is_file():
        raise MCPError("MCP_TOOL_CALL_FAILED", f"model weights not found: {weights_path}")

    with config_path.open("r", encoding="utf-8") as fh:
        model_cfg = json.load(fh)

    if not isinstance(model_cfg, dict):
        raise MCPError("MCP_TOOL_CALL_FAILED", "model config root must be an object")

    architecture = model_cfg.get("architecture")
    num_classes = model_cfg.get("num_classes")
    label_names = model_cfg.get("label_names")

    if not isinstance(architecture, str) or not architecture.strip():
        raise MCPError("MCP_TOOL_CALL_FAILED", "config.json missing valid architecture")
    if isinstance(num_classes, bool) or not isinstance(num_classes, int) or num_classes <= 0:
        raise MCPError("MCP_TOOL_CALL_FAILED", "config.json missing valid num_classes")
    if not isinstance(label_names, list) or not all(isinstance(item, str) for item in label_names):
        raise MCPError("MCP_TOOL_CALL_FAILED", "config.json missing valid label_names")
    if len(label_names) != num_classes:
        raise MCPError(
            "MCP_TOOL_CALL_FAILED",
            f"label_names size ({len(label_names)}) does not match num_classes ({num_classes})",
        )

    pretrained_cfg = model_cfg.get("pretrained_cfg")
    if pretrained_cfg is not None and not isinstance(pretrained_cfg, dict):
        pretrained_cfg = {}

    return {
        "architecture": architecture.strip(),
        "num_classes": num_classes,
        "labels": label_names,
        "weights_path": weights_path,
        "pretrained_cfg": pretrained_cfg or {},
    }


def build_eval_transform(create_transform_fn, resolve_data_config_fn, model, pretrained_cfg: dict[str, Any]):
    allowed = set(inspect.signature(create_transform_fn).parameters.keys())
    args: dict[str, Any] = {"is_training": False}

    for key in ["input_size", "interpolation", "mean", "std", "crop_pct"]:
        if key in pretrained_cfg and key in allowed:
            args[key] = pretrained_cfg[key]

    if "input_size" in args and isinstance(args["input_size"], list):
        args["input_size"] = tuple(args["input_size"])
    if "mean" in args and isinstance(args["mean"], list):
        args["mean"] = tuple(float(v) for v in args["mean"])
    if "std" in args and isinstance(args["std"], list):
        args["std"] = tuple(float(v) for v in args["std"])

    try:
        if len(args) > 1:
            return create_transform_fn(**args)
    except Exception:
        pass

    fallback_cfg = resolve_data_config_fn({}, model=model)
    fallback_args: dict[str, Any] = {"is_training": False}
    for key in ["input_size", "interpolation", "mean", "std", "crop_pct"]:
        if key in fallback_cfg and key in allowed:
            fallback_args[key] = fallback_cfg[key]

    return create_transform_fn(**fallback_args)


class TimmClassifier:
    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.config = self.load_plugin_config(config_path)
        self.startup_error: str | None = None

        self.model = None
        self.transform = None
        self.labels: list[str] = []
        self.device_name = "cpu"
        self.model_loaded = False

        self.torch = None
        self.pil_image = None

    def load_plugin_config(self, config_path: Path) -> dict[str, Any]:
        if not config_path.exists() or not config_path.is_file():
            raise MCPError("MCP_TOOL_CALL_FAILED", f"config file not found: {config_path}")

        with config_path.open("r", encoding="utf-8") as fh:
            parsed = json.load(fh)

        if not isinstance(parsed, dict):
            raise MCPError("MCP_TOOL_CALL_FAILED", "config root must be an object")

        model_dir_raw = parsed.get("modelDir")
        if not isinstance(model_dir_raw, str) or not model_dir_raw.strip():
            raise MCPError("MCP_TOOL_CALL_FAILED", "modelDir must be a non-empty string")

        device = parsed.get("device", "auto")
        if device not in {"auto", "cpu", "cuda"}:
            raise MCPError("MCP_TOOL_CALL_FAILED", 'device must be one of: "auto", "cpu", "cuda"')

        model_dir = resolve_model_dir_path(config_path.parent, model_dir_raw.strip())
        if not model_dir.exists() or not model_dir.is_dir():
            raise MCPError("MCP_TOOL_CALL_FAILED", f"modelDir not found: {model_dir}")

        bundle = load_model_bundle_metadata(model_dir)

        return {
            "modelDir": str(model_dir),
            "device": device,
            "architecture": bundle["architecture"],
            "num_classes": bundle["num_classes"],
            "labels": bundle["labels"],
            "weights_path": bundle["weights_path"],
            "pretrained_cfg": bundle["pretrained_cfg"],
        }

    def ensure_loaded(self) -> None:
        if self.model_loaded:
            return
        if self.startup_error:
            raise MCPError("MCP_TOOL_CALL_FAILED", self.startup_error)

        try:
            import torch
            from PIL import Image
            import timm
            from safetensors.torch import load_file as load_safetensors
            from timm.data import create_transform, resolve_data_config
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"missing Python dependencies: {error}") from error

        architecture = self.config["architecture"]
        num_classes = self.config["num_classes"]
        labels = self.config["labels"]
        weights_path: Path = self.config["weights_path"]

        model = timm.create_model(architecture, pretrained=False, num_classes=num_classes)
        try:
            state_dict = load_safetensors(str(weights_path), device="cpu")
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to read safetensors: {error}") from error

        state_dict = strip_module_prefix(state_dict)
        try:
            model.load_state_dict(state_dict, strict=True)
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"checkpoint keys mismatch: {error}") from error

        requested_device = self.config["device"]
        if requested_device == "cuda":
            if not torch.cuda.is_available():
                raise MCPError("MCP_TOOL_CALL_FAILED", "CUDA requested but not available")
            device_name = "cuda"
        elif requested_device == "cpu":
            device_name = "cpu"
        else:
            device_name = "cuda" if torch.cuda.is_available() else "cpu"

        device = torch.device(device_name)
        model.eval()
        model.to(device)

        transform = build_eval_transform(
            create_transform,
            resolve_data_config,
            model,
            self.config.get("pretrained_cfg", {}),
        )

        self.torch = torch
        self.pil_image = Image
        self.model = model
        self.transform = transform
        self.labels = labels
        self.device_name = device_name
        self.model_loaded = True

    def classify_path(self, image_path: Path, top_k: int, min_score: float) -> list[dict[str, Any]]:
        self.ensure_loaded()
        assert self.torch is not None
        assert self.transform is not None
        assert self.model is not None
        assert self.pil_image is not None

        try:
            with self.pil_image.open(image_path) as img:
                rgb = img.convert("RGB")
                tensor = self.transform(rgb).unsqueeze(0)
        except Exception as error:
            raise MCPError("MCP_INVALID_PARAMS", f"failed to decode image: {image_path}") from error

        tensor = tensor.to(self.device_name)
        with self.torch.no_grad():
            logits = self.model(tensor)
            if hasattr(logits, "logits"):
                logits = logits.logits
            probs = self.torch.nn.functional.softmax(logits, dim=-1)[0]

        num_outputs = int(probs.shape[-1])
        effective_top_k = min(top_k, num_outputs)
        values, indices = self.torch.topk(probs, k=effective_top_k)

        predictions: list[dict[str, Any]] = []
        for score_tensor, index_tensor in zip(values.tolist(), indices.tolist()):
            score = float(score_tensor)
            if score < min_score:
                continue
            index = int(index_tensor)
            label = self.labels[index] if 0 <= index < len(self.labels) else str(index)
            predictions.append({"label": label, "score": score, "index": index})
        return predictions

    def classify_image(self, params: dict[str, Any]) -> dict[str, Any]:
        root_path = params.get("rootPath")
        relative_path = params.get("relativePath")
        top_k = parse_top_k(params.get("topK"))
        min_score = parse_min_score(params.get("minScore"))

        target = resolve_image_path(root_path, relative_path)
        start = time.perf_counter()
        predictions = self.classify_path(target, top_k, min_score)
        timing_ms = round((time.perf_counter() - start) * 1000, 3)

        return {
            "model": self.config["architecture"],
            "device": self.device_name,
            "timingMs": timing_ms,
            "predictions": predictions,
        }

    def classify_batch(self, params: dict[str, Any]) -> dict[str, Any]:
        root_path = params.get("rootPath")
        relative_paths = params.get("relativePaths")
        top_k = parse_top_k(params.get("topK"))
        min_score = parse_min_score(params.get("minScore"))
        max_items = parse_max_items(params.get("maxItems"))

        if not isinstance(root_path, str) or not root_path.strip():
            raise MCPError("MCP_INVALID_PARAMS", "rootPath is required")
        if not isinstance(relative_paths, list) or not all(isinstance(item, str) for item in relative_paths):
            raise MCPError("MCP_INVALID_PARAMS", "relativePaths must be string[]")
        if len(relative_paths) == 0:
            raise MCPError("MCP_INVALID_PARAMS", "relativePaths must not be empty")
        if len(relative_paths) > max_items:
            raise MCPError("MCP_INVALID_PARAMS", f"relativePaths exceeds maxItems ({max_items})")

        self.ensure_loaded()

        items = []
        succeeded = 0
        failed = 0
        start = time.perf_counter()

        for relative_path in relative_paths:
            try:
                target = resolve_image_path(root_path, relative_path)
                predictions = self.classify_path(target, top_k, min_score)
                items.append(
                    {
                        "relativePath": relative_path,
                        "ok": True,
                        "predictions": predictions,
                    }
                )
                succeeded += 1
            except MCPError as error:
                items.append(
                    {
                        "relativePath": relative_path,
                        "ok": False,
                        "error": str(error),
                    }
                )
                failed += 1
            except Exception as error:
                items.append(
                    {
                        "relativePath": relative_path,
                        "ok": False,
                        "error": str(error),
                    }
                )
                failed += 1

        timing_ms = round((time.perf_counter() - start) * 1000, 3)
        return {
            "model": self.config["architecture"],
            "device": self.device_name,
            "timingMs": timing_ms,
            "succeeded": succeeded,
            "failed": failed,
            "items": items,
        }


TOOL_DEFINITIONS = [
    {
        "name": "ml.classifyImage",
        "description": "Classify one image with timm model",
        "inputSchema": {
            "type": "object",
            "properties": {
                "rootPath": {"type": "string"},
                "relativePath": {"type": "string"},
                "topK": {"type": "integer", "minimum": 1, "maximum": 20},
                "minScore": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["rootPath", "relativePath"],
            "additionalProperties": False,
        },
        "annotations": {
            "title": "图像分类",
            "mutation": False,
            "scopes": ["file"],
            "toolOptions": [
                {
                    "key": "preview.continuousCall.enabled",
                    "label": "持续调用",
                    "type": "boolean",
                    "defaultValue": False,
                    "description": "切换预览文件后自动触发图像分类",
                }
            ],
        },
    },
    {
        "name": "ml.classifyBatch",
        "description": "Classify multiple images with timm model",
        "inputSchema": {
            "type": "object",
            "properties": {
                "rootPath": {"type": "string"},
                "relativePaths": {"type": "array", "items": {"type": "string"}},
                "topK": {"type": "integer", "minimum": 1, "maximum": 20},
                "minScore": {"type": "number", "minimum": 0, "maximum": 1},
                "maxItems": {"type": "integer", "minimum": 1, "maximum": 1024},
            },
            "required": ["rootPath", "relativePaths"],
            "additionalProperties": False,
        },
        "annotations": {
            "title": "批量图像分类",
            "mutation": False,
            "scopes": ["workspace"],
        },
    },
]


def handle_request(request: dict[str, Any], classifier: TimmClassifier) -> dict[str, Any] | None:
    method = request["method"]
    params = request["params"]

    if method == "initialize":
        return {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }

    if method == "notifications/initialized":
        return None

    if method == "tools/list":
        return {"tools": TOOL_DEFINITIONS}

    if method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments")
        if not isinstance(tool_name, str) or not tool_name:
            raise MCPError("MCP_INVALID_PARAMS", "params.name is required for tools/call")
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            raise MCPError("MCP_INVALID_PARAMS", "params.arguments must be an object")

        if tool_name == "ml.classifyImage":
            return classifier.classify_image(arguments)
        if tool_name == "ml.classifyBatch":
            return classifier.classify_batch(arguments)
        raise MCPError("MCP_TOOL_NOT_FOUND", f"Unsupported tool: {tool_name}")

    raise MCPError("MCP_METHOD_NOT_FOUND", f"Unsupported MCP method: {method}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fauplay timm classification MCP server")
    parser.add_argument(
        "--config",
        type=str,
        default=".fauplay/timm-classifier.json",
        help="Path to timm classifier config file",
    )
    return parser.parse_args()


class FallbackClassifier:
    def __init__(self, error_message: str, config_path: Path):
        self.error_message = error_message
        self.config = {
            "architecture": f"invalid-config:{config_path.name}",
        }

    def classify_image(self, _params: dict[str, Any]) -> dict[str, Any]:
        raise MCPError("MCP_TOOL_CALL_FAILED", self.error_message)

    def classify_batch(self, _params: dict[str, Any]) -> dict[str, Any]:
        raise MCPError("MCP_TOOL_CALL_FAILED", self.error_message)


def main() -> int:
    args = parse_args()
    config_path = Path(args.config).expanduser().resolve()

    try:
        classifier: TimmClassifier | FallbackClassifier = TimmClassifier(config_path)
    except Exception as error:
        classifier = FallbackClassifier(str(error), config_path)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        is_notification = False
        try:
            payload = json.loads(line)
            request = parse_jsonrpc_request(payload)
            request_id = request["id"]
            is_notification = request["is_notification"]

            result = handle_request(request, classifier)
            if is_notification:
                continue

            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": result if result is not None else {},
                }
            )
        except json.JSONDecodeError:
            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": create_jsonrpc_error(-32700, "Parse error", "MCP_PARSE_ERROR"),
                }
            )
        except Exception as error:
            if is_notification:
                continue
            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": to_jsonrpc_error(error),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
