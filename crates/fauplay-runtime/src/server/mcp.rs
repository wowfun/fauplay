use crate::FauplayRuntime;

use super::parse_json_body;
use super::{HttpResponse, http_response_with_headers, parse_header_value};

pub(in crate::server) fn handle_mcp_json_rpc(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let response =
        runtime.handle_mcp_request(parse_header_value(request, "mcp-session-id"), payload);
    let headers = response
        .session_id
        .map(|session_id| vec![("mcp-session-id".to_owned(), session_id)])
        .unwrap_or_default();

    match response.body {
        Some(body) => http_response_with_headers(
            200,
            "OK",
            &serde_json::to_string(&body).expect("MCP JSON-RPC response should serialize"),
            headers,
        ),
        None => http_response_with_headers(204, "No Content", "", headers),
    }
}
