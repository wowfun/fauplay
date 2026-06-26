use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;

use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_faces_detects_and_lists_file_faces_through_runtime_mcp() {
    let fixture =
        Fixture::new("runtime_api_faces_detects_and_lists_file_faces_through_runtime_mcp");
    let runtime_home_path = fixture.root.join("runtime-home");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fixture.write_file("local-root/photos/ada.jpg", "fake image bytes");
    fixture.write_file(
        "mock-vision-face-server.mjs",
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
          name: 'vision.face',
          description: 'Detect faces',
          inputSchema: { type: 'object' }
        }]
      }
    }) + '\n')
    return
  }

  if (request.method === 'tools/call' && request.params?.name === 'vision.face') {
    const args = request.params.arguments ?? {}
    if (args.operation !== 'detectAsset' || args.relativePath !== 'photos/ada.jpg') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32602,
          message: 'unexpected vision.face arguments',
          data: { code: 'MCP_INVALID_PARAMS' }
        }
      }) + '\n')
      return
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        faces: [{
          boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.7 },
          score: 0.97,
          mediaType: 'image',
          embedding: [0.1, 0.2, 0.3]
        }]
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
    let mock_server_path = fixture.root.join("mock-vision-face-server.mjs");
    let config_path = fixture.root.join("mcp.json");
    fs::write(
        &config_path,
        serde_json::json!({
            "servers": {
                "vision": {
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
    let root_path = fixture.root.join("local-root");
    let detect_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "relativePath": "photos/ada.jpg"
    })
    .to_string();

    let (address, server) = serve_runtime_once(runtime.clone());
    let detect_response =
        send_json_request(&address, "POST", "/v1/faces/detect-asset", &detect_body);
    server.join().expect("server thread should finish");

    assert!(
        detect_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "detect-asset should be handled by the Rust Runtime: {detect_response}"
    );
    let detect_json = response_json(&detect_response);
    assert_eq!(detect_json["ok"], true);
    assert_eq!(detect_json["assetPath"], "photos/ada.jpg");
    assert_eq!(detect_json["detected"], 1);
    assert_eq!(detect_json["created"], 1);
    assert_eq!(detect_json["faces"][0]["boundingBox"]["x1"], 0.1);
    assert_eq!(detect_json["faces"][0]["status"], "unassigned");
    assert_eq!(detect_json["faces"][0]["mediaType"], "image");

    let list_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "relativePath": "photos/ada.jpg"
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let list_response =
        send_json_request(&address, "POST", "/v1/faces/list-asset-faces", &list_body);
    server.join().expect("server thread should finish");

    assert!(
        list_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "list-asset-faces should be handled by the Rust Runtime: {list_response}"
    );
    let list_json = response_json(&list_response);
    assert_eq!(list_json["ok"], true);
    assert_eq!(list_json["scope"], "root");
    assert_eq!(list_json["total"], 1);
    assert_eq!(list_json["items"][0]["assetPath"], "photos/ada.jpg");
    assert_eq!(list_json["items"][0]["score"], 0.97);
    assert_eq!(list_json["items"][0]["personId"], serde_json::Value::Null);

    let list_person_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "personId": "person-without-faces"
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime);
    let list_person_response = send_json_request(
        &address,
        "POST",
        "/v1/faces/list-asset-faces",
        &list_person_body,
    );
    server.join().expect("server thread should finish");

    assert!(
        list_person_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "person-scoped list-asset-faces should be a Runtime-owned request shape: {list_person_response}"
    );
    assert_eq!(
        response_json(&list_person_response)["items"],
        serde_json::json!([])
    );
}

fn send_json_request(address: &str, method: &str, path: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn response_json(response: &str) -> serde_json::Value {
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .expect("HTTP response should contain a body separator");
    serde_json::from_str(body).expect("HTTP response body should be JSON")
}
