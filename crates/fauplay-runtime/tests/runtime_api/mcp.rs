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
