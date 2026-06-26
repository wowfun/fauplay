use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

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
    let (address, server) = serve_runtime_once(runtime.clone());
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

    let list_review_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "bucket": "unassigned"
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let list_review_response = send_json_request(
        &address,
        "POST",
        "/v1/faces/list-review-faces",
        &list_review_body,
    );
    server.join().expect("server thread should finish");

    assert!(
        list_review_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "list-review-faces should be handled by the Rust Runtime: {list_review_response}"
    );
    let list_review_json = response_json(&list_review_response);
    assert_eq!(list_review_json["ok"], true);
    assert_eq!(list_review_json["scope"], "root");
    assert_eq!(list_review_json["bucket"], "unassigned");
    assert_eq!(list_review_json["total"], 1);
    assert_eq!(list_review_json["items"][0]["assetPath"], "photos/ada.jpg");
    assert_eq!(list_review_json["items"][0]["status"], "unassigned");
}

#[test]
fn runtime_api_faces_lists_people_from_runtime_home() {
    let fixture = Fixture::new("runtime_api_faces_lists_people_from_runtime_home");
    let runtime_home_path = fixture.root.join("runtime-home");
    let root_path = fixture.root.join("local-root");
    let other_root_path = fixture.root.join("other-root");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fs::create_dir_all(&root_path).expect("Local Root should be created");
    fs::create_dir_all(&other_root_path).expect("other Local Root should be created");
    write_people_face_store(&runtime_home_path, &root_path, &other_root_path);

    let runtime = FauplayRuntime::with_runtime_home_path(runtime_home_path);
    let list_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "scope": "root",
        "page": 1,
        "size": 10
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let list_response = send_json_request(&address, "POST", "/v1/faces/list-people", &list_body);
    server.join().expect("server thread should finish");

    assert!(
        list_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "list-people should be handled by the Rust Runtime: {list_response}"
    );
    let list_json = response_json(&list_response);
    assert_eq!(list_json["ok"], true);
    assert_eq!(list_json["scope"], "root");
    assert_eq!(list_json["total"], 2);
    assert_eq!(list_json["items"][0]["personId"], "person-a");
    assert_eq!(list_json["items"][0]["name"], "Ada");
    assert_eq!(list_json["items"][0]["faceCount"], 2);
    assert_eq!(list_json["items"][0]["globalFaceCount"], 3);
    assert_eq!(list_json["items"][0]["featureFaceId"], "face-a-2");
    assert_eq!(
        list_json["items"][0]["featureAssetPath"],
        "photos/ada-2.jpg"
    );
    assert_eq!(list_json["items"][1]["personId"], "person-b");
    assert_eq!(list_json["items"][1]["name"], "");

    let query_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "scope": "root",
        "query": "ada",
        "page": 1,
        "size": 10
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let query_response = send_json_request(&address, "POST", "/v1/faces/list-people", &query_body);
    server.join().expect("server thread should finish");

    assert!(
        query_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "query list-people should be handled by the Rust Runtime: {query_response}"
    );
    let query_json = response_json(&query_response);
    assert_eq!(query_json["total"], 1);
    assert_eq!(query_json["items"][0]["personId"], "person-a");

    let global_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "scope": "global",
        "page": 1,
        "size": 10
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let global_response =
        send_json_request(&address, "POST", "/v1/faces/list-people", &global_body);
    server.join().expect("server thread should finish");

    assert!(
        global_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "global list-people should be handled by the Rust Runtime: {global_response}"
    );
    let global_json = response_json(&global_response);
    assert_eq!(global_json["scope"], "global");
    assert_eq!(global_json["total"], 2);
    assert_eq!(global_json["items"][0]["personId"], "person-a");
    assert_eq!(global_json["items"][0]["faceCount"], 3);
    assert_eq!(global_json["items"][0]["globalFaceCount"], 3);
    assert_eq!(global_json["items"][0]["featureFaceId"], "face-a-outside");
    assert_eq!(
        global_json["items"][0]["featureAssetPath"],
        other_root_path
            .join("photos/outside.jpg")
            .display()
            .to_string()
    );

    let rename_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "personId": "person-a",
        "name": "Dr Ada"
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let rename_response =
        send_json_request(&address, "POST", "/v1/faces/rename-person", &rename_body);
    server.join().expect("server thread should finish");

    assert!(
        rename_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "rename-person should be handled by the Rust Runtime: {rename_response}"
    );
    let rename_json = response_json(&rename_response);
    assert_eq!(rename_json["ok"], true);
    assert_eq!(rename_json["person"]["personId"], "person-a");
    assert_eq!(rename_json["person"]["name"], "Dr Ada");
    assert_eq!(rename_json["person"]["faceCount"], 2);
    assert_eq!(rename_json["person"]["globalFaceCount"], 3);

    let renamed_faces_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "scope": "root",
        "personId": "person-a"
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime);
    let renamed_faces_response = send_json_request(
        &address,
        "POST",
        "/v1/faces/list-asset-faces",
        &renamed_faces_body,
    );
    server.join().expect("server thread should finish");

    assert!(
        renamed_faces_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "renamed person faces should still be listed by the Rust Runtime: {renamed_faces_response}"
    );
    let renamed_faces_json = response_json(&renamed_faces_response);
    assert_eq!(renamed_faces_json["items"][0]["personName"], "Dr Ada");
}

fn write_people_face_store(runtime_home_path: &Path, root_path: &Path, other_root_path: &Path) {
    let store_path = runtime_home_path.join("global").join("faces.v1.json");
    fs::create_dir_all(store_path.parent().unwrap()).expect("face store parent should be created");
    fs::write(
        store_path,
        serde_json::json!({
            "version": 1,
            "faces": [
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/ada-1.jpg",
                    "assetId": "asset-a-1",
                    "faceId": "face-a-1",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.4 },
                    "score": 0.91,
                    "status": "assigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": "person-a",
                    "personName": "Ada",
                    "assignedBy": "manual",
                    "updatedAt": 10,
                    "embedding": [0.1, 0.2]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/ada-2.jpg",
                    "assetId": "asset-a-2",
                    "faceId": "face-a-2",
                    "boundingBox": { "x1": 0.2, "y1": 0.1, "x2": 0.4, "y2": 0.5 },
                    "score": 0.94,
                    "status": "assigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": "person-a",
                    "personName": "Ada",
                    "assignedBy": "manual",
                    "updatedAt": 30,
                    "embedding": [0.2, 0.3]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/unnamed.jpg",
                    "assetId": "asset-b",
                    "faceId": "face-b",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.89,
                    "status": "assigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": "person-b",
                    "personName": "",
                    "assignedBy": "cluster",
                    "updatedAt": 20,
                    "embedding": [0.4, 0.5]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/unassigned.jpg",
                    "assetId": "asset-unassigned",
                    "faceId": "face-unassigned",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.8,
                    "status": "unassigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": null,
                    "personName": null,
                    "assignedBy": null,
                    "updatedAt": 40,
                    "embedding": [0.6, 0.7]
                },
                {
                    "rootPath": other_root_path.display().to_string(),
                    "rootRelativePath": "photos/outside.jpg",
                    "assetId": "asset-outside",
                    "faceId": "face-a-outside",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.89,
                    "status": "assigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": "person-a",
                    "personName": "Ada",
                    "assignedBy": "manual",
                    "updatedAt": 50,
                    "embedding": [0.8, 0.9]
                }
            ]
        })
        .to_string(),
    )
    .expect("face store should be written");
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
