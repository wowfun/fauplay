use std::fs;

use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_mcp_lists_tools_after_initialize_lifecycle() {
    let runtime = FauplayRuntime::new();
    let (address, server) = serve_runtime_once(runtime.clone());

    let initialize_response = send_mcp_request(
        &address,
        None,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.0"}}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        initialize_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "initialize response should be OK: {initialize_response}"
    );
    let session_id = response_header(&initialize_response, "mcp-session-id")
        .expect("initialize response should include an MCP session id");
    assert!(
        initialize_response.contains("\"serverInfo\":{\"name\":\"fauplay-runtime\""),
        "initialize response should identify the Runtime MCP server: {initialize_response}"
    );
    assert!(
        initialize_response
            .to_lowercase()
            .contains("access-control-expose-headers: mcp-session-id"),
        "initialize response should expose the MCP session header to browsers: {initialize_response}"
    );

    let (address, server) = serve_runtime_once(runtime.clone());
    let initialized_response = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        initialized_response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "initialized notification should be accepted without a response body: {initialized_response}"
    );

    let (address, server) = serve_runtime_once(runtime);
    let list_response = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        list_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "tools/list response should be OK: {list_response}"
    );
    assert!(
        list_response.contains("\"id\":2"),
        "tools/list response should preserve the JSON-RPC id: {list_response}"
    );
    assert!(
        list_response.contains("\"tools\":[]"),
        "tools/list response should expose the Runtime plugin registry: {list_response}"
    );
}

#[test]
fn runtime_api_mcp_rejects_tools_list_without_initialized_session() {
    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_mcp_request(
        &address,
        None,
        r#"{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "JSON-RPC errors should still use an HTTP OK envelope: {response}"
    );
    assert!(
        response.contains("\"id\":7"),
        "error response should preserve the JSON-RPC id: {response}"
    );
    assert!(
        response.contains("\"code\":\"MCP_INVALID_REQUEST\""),
        "error response should expose the Runtime MCP error code: {response}"
    );
}

#[test]
fn runtime_api_mcp_reports_unknown_tool_calls() {
    let runtime = FauplayRuntime::new();
    let (address, server) = serve_runtime_once(runtime.clone());
    let initialize_response = send_mcp_request(
        &address,
        None,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
    );
    server.join().expect("server thread should finish");
    let session_id = response_header(&initialize_response, "mcp-session-id")
        .expect("initialize response should include an MCP session id");

    let (address, server) = serve_runtime_once(runtime.clone());
    let _ = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
    );
    server.join().expect("server thread should finish");

    let (address, server) = serve_runtime_once(runtime);
    let call_response = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"missing.tool","arguments":{}}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        call_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "JSON-RPC errors should still use an HTTP OK envelope: {call_response}"
    );
    assert!(
        call_response.contains("\"code\":\"MCP_TOOL_NOT_FOUND\""),
        "unknown tool response should expose the Runtime MCP error code: {call_response}"
    );
}

#[test]
fn runtime_api_mcp_lists_and_calls_configured_stdio_tools() {
    let fixture = Fixture::new("runtime_api_mcp_lists_and_calls_configured_stdio_tools");
    let runtime_home_path = fixture.root.join("runtime-home");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fixture.write_file(
        "mock-mcp-server.mjs",
        r#"
import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [{
          name: 'fixture.echo',
          description: 'Echo test input',
          inputSchema: { type: 'object' },
          annotations: {
            title: 'Fixture Echo',
            scopes: ['workspace'],
            mutation: false
          }
        }]
      }
    }) + '\n')
    return
  }

  if (request.method === 'tools/call' && request.params?.name === 'fixture.echo') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        echoed: request.params.arguments?.message ?? null
      }
    }) + '\n')
    return
  }

  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32000,
      message: 'unknown tool',
      data: { code: 'MCP_TOOL_NOT_FOUND' }
    }
  }) + '\n')
})
"#,
    );
    let mock_server_path = fixture.root.join("mock-mcp-server.mjs");
    let config_path = fixture.root.join("mcp.json");
    fs::write(
        &config_path,
        serde_json::json!({
            "servers": {
                "fixture": {
                    "type": "stdio",
                    "command": "node",
                    "args": [mock_server_path.display().to_string()],
                    "callTimeoutMs": 2000,
                    "initTimeoutMs": 2000
                }
            }
        })
        .to_string(),
    )
    .expect("MCP config should be written");

    let runtime =
        FauplayRuntime::with_runtime_home_path_and_mcp_config_path(runtime_home_path, config_path);
    let session_id = initialize_mcp_session(&runtime);

    let (address, server) = serve_runtime_once(runtime.clone());
    let list_response = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","id":20,"method":"tools/list","params":{}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        list_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "tools/list response should be OK: {list_response}"
    );
    assert!(
        response_json(&list_response)["result"]["tools"]
            .as_array()
            .is_some_and(|tools| tools.len() == 1),
        "tools/list should return the configured stdio tool: {list_response}"
    );
    assert!(
        list_response.contains("\"name\":\"fixture.echo\""),
        "tools/list should include the tool name: {list_response}"
    );
    assert!(
        list_response.contains("\"title\":\"Fixture Echo\""),
        "tools/list should normalize the annotation title: {list_response}"
    );

    let (address, server) = serve_runtime_once(runtime);
    let call_response = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"fixture.echo","arguments":{"message":"hello runtime"}}}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        call_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "tools/call response should be OK: {call_response}"
    );
    assert_eq!(
        response_json(&call_response)["result"]["echoed"],
        "hello runtime"
    );
}

fn initialize_mcp_session(runtime: &FauplayRuntime) -> String {
    let (address, server) = serve_runtime_once(runtime.clone());
    let initialize_response = send_mcp_request(
        &address,
        None,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
    );
    server.join().expect("server thread should finish");
    let session_id = response_header(&initialize_response, "mcp-session-id")
        .expect("initialize response should include an MCP session id");

    let (address, server) = serve_runtime_once(runtime.clone());
    let initialized_response = send_mcp_request(
        &address,
        Some(&session_id),
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        initialized_response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "initialized notification should be accepted: {initialized_response}"
    );

    session_id
}

fn response_json(response: &str) -> serde_json::Value {
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .expect("HTTP response should contain a body separator");
    serde_json::from_str(body).expect("HTTP response body should be JSON")
}
