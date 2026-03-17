#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any

from inference import read_config
from operations import VisionFaceService
from protocol import (
    MCPError,
    MCP_PROTOCOL_VERSION,
    SERVER_NAME,
    SERVER_VERSION,
    TOOL_DEFINITIONS,
    create_jsonrpc_error,
    parse_jsonrpc_request,
    to_jsonrpc_error,
    write_jsonrpc,
)


def handle_request(request: dict[str, Any], service: VisionFaceService) -> dict[str, Any] | None:
    method = request["method"]

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
        params = request["params"]
        tool_name = params.get("name")
        tool_args = params.get("arguments", {})
        if not isinstance(tool_name, str) or not tool_name:
            raise MCPError("MCP_INVALID_PARAMS", "params.name is required for tools/call")
        if tool_name != "vision.face":
            raise MCPError("MCP_TOOL_NOT_FOUND", f"Unsupported tool: {tool_name}")
        if tool_args is not None and not isinstance(tool_args, dict):
            raise MCPError("MCP_INVALID_PARAMS", "params.arguments must be an object")
        return service.handle_tool_call(tool_args or {})

    raise MCPError("MCP_METHOD_NOT_FOUND", f"Unsupported MCP method: {method}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fauplay vision.face MCP server")
    parser.add_argument(
        "--config",
        type=Path,
        default=(Path(__file__).resolve().parent / "config.json"),
        help="Path to server config file",
    )
    options = parser.parse_args()

    try:
        config = read_config(options.config)
        service = VisionFaceService(config)
    except Exception as error:
        write_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": None,
                "error": to_jsonrpc_error(error if isinstance(error, Exception) else Exception(str(error))),
            }
        )
        return 1

    for line in sys_stdin_lines():
        request_id: Any = None
        is_notification = False
        try:
            payload = json.loads(line)
            request = parse_jsonrpc_request(payload)
            request_id = request["id"]
            is_notification = bool(request["is_notification"])

            result = handle_request(request, service)
            if is_notification:
                continue

            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": result if result is not None else {},
                }
            )
        except Exception as error:
            if is_notification:
                continue
            if isinstance(error, json.JSONDecodeError):
                write_jsonrpc(
                    {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": create_jsonrpc_error(-32700, "Parse error", "MCP_PARSE_ERROR"),
                    }
                )
                continue

            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": to_jsonrpc_error(error if isinstance(error, Exception) else Exception(str(error))),
                }
            )

    return 0


def sys_stdin_lines():
    import sys

    for line in sys.stdin:
        if line.strip():
            yield line


if __name__ == "__main__":
    raise SystemExit(main())
