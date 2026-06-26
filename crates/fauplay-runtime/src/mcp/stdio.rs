use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::config::McpServerEntry;
use super::{McpRuntimeError, McpRuntimeErrorCode};

pub(super) struct StdioMcpClient {
    entry: McpServerEntry,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    responses: Option<Receiver<Value>>,
    next_request_id: u64,
    tools_cache: Option<Vec<Value>>,
}

impl StdioMcpClient {
    pub(super) fn new(entry: McpServerEntry) -> Self {
        Self {
            entry,
            child: None,
            stdin: None,
            responses: None,
            next_request_id: 1,
            tools_cache: None,
        }
    }

    pub(super) fn source_label(&self) -> &str {
        &self.entry.source_label
    }

    pub(super) fn list_tools(&mut self) -> Result<Vec<Value>, McpRuntimeError> {
        self.ensure_started()?;
        if let Some(tools) = self.tools_cache.clone() {
            return Ok(tools);
        }

        let result = self.request("tools/list", json!({}), self.entry.init_timeout_ms)?;
        let tools = result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        self.tools_cache = Some(tools.clone());
        Ok(tools)
    }

    pub(super) fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value, McpRuntimeError> {
        self.ensure_started()?;
        self.request(
            "tools/call",
            json!({
                "name": tool_name,
                "arguments": arguments,
            }),
            self.entry.call_timeout_ms,
        )
    }

    fn ensure_started(&mut self) -> Result<(), McpRuntimeError> {
        if self.child_is_running()? {
            return Ok(());
        }

        self.start_process()
    }

    fn child_is_running(&mut self) -> Result<bool, McpRuntimeError> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };
        match child.try_wait() {
            Ok(None) => Ok(true),
            Ok(Some(_)) => {
                self.child = None;
                self.stdin = None;
                self.responses = None;
                self.tools_cache = None;
                Ok(false)
            }
            Err(error) => Err(McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "Failed to inspect MCP server: {} ({error})",
                    self.entry.source_label
                ),
            )),
        }
    }

    fn start_process(&mut self) -> Result<(), McpRuntimeError> {
        let mut command = Command::new(&self.entry.command);
        command.args(&self.entry.args);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        if let Some(cwd) = &self.entry.cwd {
            command.current_dir(cwd);
        }
        for (key, value) in &self.entry.env {
            command.env(key, value);
        }

        let mut child = command.spawn().map_err(|error| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "Failed to start MCP server: {} ({error})",
                    self.entry.source_label
                ),
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "MCP server stdin is unavailable: {}",
                    self.entry.source_label
                ),
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "MCP server stdout is unavailable: {}",
                    self.entry.source_label
                ),
            )
        })?;
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                let mut buffer = [0_u8; 1024];
                while matches!(reader.read(&mut buffer), Ok(count) if count > 0) {}
            });
        }

        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    let _ = sender.send(value);
                }
            }
        });

        self.child = Some(child);
        self.stdin = Some(stdin);
        self.responses = Some(receiver);
        self.tools_cache = None;
        Ok(())
    }

    fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, McpRuntimeError> {
        let id = self.next_request_id;
        self.next_request_id += 1;
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let stdin = self.stdin.as_mut().ok_or_else(|| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!("MCP server is not running: {}", self.entry.source_label),
            )
        })?;
        writeln!(stdin, "{payload}").map_err(|error| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "Failed to write MCP request: {} ({error})",
                    self.entry.source_label
                ),
            )
        })?;
        stdin.flush().map_err(|error| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "Failed to flush MCP request: {} ({error})",
                    self.entry.source_label
                ),
            )
        })?;

        self.wait_for_response(id, method, timeout_ms)
    }

    fn wait_for_response(
        &mut self,
        id: u64,
        method: &str,
        timeout_ms: u64,
    ) -> Result<Value, McpRuntimeError> {
        let receiver = self.responses.as_ref().ok_or_else(|| {
            McpRuntimeError::new(
                McpRuntimeErrorCode::ServerCrashed,
                format!(
                    "MCP server response channel is unavailable: {}",
                    self.entry.source_label
                ),
            )
        })?;
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);

        loop {
            let now = Instant::now();
            if now >= deadline {
                return Err(McpRuntimeError::new(
                    McpRuntimeErrorCode::ServerTimeout,
                    format!("MCP request timeout: {method}"),
                ));
            }

            let remaining = deadline.saturating_duration_since(now);
            let response = match receiver.recv_timeout(remaining) {
                Ok(response) => response,
                Err(RecvTimeoutError::Timeout) => {
                    return Err(McpRuntimeError::new(
                        McpRuntimeErrorCode::ServerTimeout,
                        format!("MCP request timeout: {method}"),
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(McpRuntimeError::new(
                        McpRuntimeErrorCode::ServerCrashed,
                        format!("MCP server exited: {}", self.entry.source_label),
                    ));
                }
            };

            if response.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }

            if let Some(error) = response.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP server returned an error");
                let remote_code = error
                    .get("data")
                    .and_then(|data| data.get("code"))
                    .and_then(Value::as_str)
                    .unwrap_or("MCP_TOOL_CALL_FAILED");
                return Err(McpRuntimeError::new(
                    normalize_remote_error_code(remote_code),
                    message,
                ));
            }

            return Ok(response.get("result").cloned().unwrap_or_else(|| json!({})));
        }
    }
}

impl Drop for StdioMcpClient {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn normalize_remote_error_code(value: &str) -> McpRuntimeErrorCode {
    match value {
        "MCP_TOOL_NOT_FOUND" => McpRuntimeErrorCode::ToolNotFound,
        "MCP_INVALID_PARAMS" => McpRuntimeErrorCode::InvalidParams,
        "MCP_SERVER_TIMEOUT" => McpRuntimeErrorCode::ServerTimeout,
        "MCP_SERVER_CRASHED" => McpRuntimeErrorCode::ServerCrashed,
        "MCP_TOOL_CALL_FAILED" => McpRuntimeErrorCode::ToolCallFailed,
        _ => McpRuntimeErrorCode::ToolCallFailed,
    }
}
