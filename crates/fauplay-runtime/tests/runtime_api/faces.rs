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
fn runtime_api_faces_detects_assets_batch_through_runtime_mcp() {
    let fixture = Fixture::new("runtime_api_faces_detects_assets_batch_through_runtime_mcp");
    let runtime_home_path = fixture.root.join("runtime-home");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fixture.write_file("local-root/photos/ada.jpg", "fake image bytes");
    fixture.write_file("local-root/docs/readme.txt", "not media");
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
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.8 },
          score: 0.98,
          mediaType: 'image',
          embedding: [0.4, 0.5, 0.6]
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
    let detect_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/detect-assets",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "relativePaths": [
                "photos/ada.jpg",
                "photos/ada.jpg",
                "docs/readme.txt"
            ],
            "runCluster": false
        }),
    );

    assert_eq!(detect_json["ok"], true);
    assert_eq!(detect_json["total"], 3);
    assert_eq!(detect_json["unique"], 2);
    assert_eq!(detect_json["scanned"], 1);
    assert_eq!(detect_json["skipped"], 2);
    assert_eq!(detect_json["failed"], 0);
    assert_eq!(detect_json["detectedFaces"], 1);
    assert_eq!(detect_json["preCluster"], serde_json::Value::Null);
    assert_eq!(detect_json["postCluster"], serde_json::Value::Null);
    assert_eq!(detect_json["items"][0]["status"], "detected");
    assert_eq!(detect_json["items"][0]["relativePath"], "photos/ada.jpg");
    assert_eq!(detect_json["items"][0]["mediaType"], "image");
    assert_eq!(detect_json["items"][0]["detected"], 1);
    assert_eq!(detect_json["items"][1]["status"], "skipped");
    assert_eq!(detect_json["items"][1]["reasonCode"], "DUPLICATE_PATH");
    assert_eq!(detect_json["items"][2]["status"], "skipped");
    assert_eq!(detect_json["items"][2]["reasonCode"], "UNSUPPORTED_MEDIA");

    let list_json = post_runtime_json(
        runtime,
        "/v1/faces/list-asset-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "relativePath": "photos/ada.jpg"
        }),
    );
    assert_eq!(list_json["total"], 1);
    assert_eq!(list_json["items"][0]["score"], 0.98);
}

#[test]
fn runtime_api_faces_detect_assets_skips_assets_after_zero_face_detection() {
    let fixture =
        Fixture::new("runtime_api_faces_detect_assets_skips_assets_after_zero_face_detection");
    let runtime_home_path = fixture.root.join("runtime-home");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fixture.write_file("local-root/photos/empty.jpg", "fake image bytes");
    fixture.write_file(
        "mock-vision-face-server.mjs",
        r#"
import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let detectCalls = 0

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
    detectCalls += 1
    if (args.operation !== 'detectAsset' || args.relativePath !== 'photos/empty.jpg' || detectCalls > 1) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32602,
          message: 'unexpected repeated vision.face call',
          data: { code: 'MCP_INVALID_PARAMS' }
        }
      }) + '\n')
      return
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { faces: [] }
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
    let request = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "relativePaths": ["photos/empty.jpg"],
        "runCluster": false
    });

    let first_json = post_runtime_json(runtime.clone(), "/v1/faces/detect-assets", request.clone());
    assert_eq!(first_json["ok"], true);
    assert_eq!(first_json["scanned"], 1);
    assert_eq!(first_json["skipped"], 0);
    assert_eq!(first_json["detectedFaces"], 0);
    assert_eq!(first_json["items"][0]["status"], "detected");
    assert_eq!(first_json["items"][0]["detected"], 0);
    assert_eq!(first_json["items"][0]["inferenceDetected"], 0);

    let second_json = post_runtime_json(runtime, "/v1/faces/detect-assets", request);
    assert_eq!(second_json["ok"], true);
    assert_eq!(second_json["scanned"], 0);
    assert_eq!(second_json["skipped"], 1);
    assert_eq!(second_json["detectedFaces"], 0);
    assert_eq!(second_json["items"][0]["status"], "skipped");
    assert_eq!(second_json["items"][0]["reasonCode"], "ALREADY_DETECTED");
    assert_eq!(second_json["items"][0]["mediaType"], "image");
    assert_eq!(second_json["items"][0]["faceCount"], 0);
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

    let default_scope_body = serde_json::json!({
        "rootPath": root_path.display().to_string(),
        "page": 1,
        "size": 10
    })
    .to_string();
    let (address, server) = serve_runtime_once(runtime.clone());
    let default_scope_response = send_json_request(
        &address,
        "POST",
        "/v1/faces/list-people",
        &default_scope_body,
    );
    server.join().expect("server thread should finish");

    assert!(
        default_scope_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "default-scope list-people should be handled by the Rust Runtime: {default_scope_response}"
    );
    let default_scope_json = response_json(&default_scope_response);
    assert_eq!(default_scope_json["scope"], "global");
    assert_eq!(default_scope_json["items"][0]["faceCount"], 3);

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

#[test]
fn runtime_api_faces_merges_people() {
    let fixture = Fixture::new("runtime_api_faces_merges_people");
    let runtime_home_path = fixture.root.join("runtime-home");
    let root_path = fixture.root.join("local-root");
    let other_root_path = fixture.root.join("other-root");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fs::create_dir_all(&root_path).expect("Local Root should be created");
    fs::create_dir_all(&other_root_path).expect("other Local Root should be created");
    write_people_face_store(&runtime_home_path, &root_path, &other_root_path);

    let runtime = FauplayRuntime::with_runtime_home_path(runtime_home_path);
    let merge_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/merge-people",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "targetPersonId": "person-a",
            "sourcePersonIds": ["person-b", "missing-person", "person-a"]
        }),
    );

    assert_eq!(merge_json["ok"], true);
    assert_eq!(merge_json["targetPersonId"], "person-a");
    assert_eq!(merge_json["merged"], 1);
    assert_eq!(
        merge_json["sourcePersonIds"],
        serde_json::json!(["person-b"])
    );
    assert_eq!(
        merge_json["skippedSourcePersonIds"],
        serde_json::json!(["missing-person"])
    );

    let people_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/list-people",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "scope": "root",
            "page": 1,
            "size": 10
        }),
    );
    assert_eq!(people_json["total"], 1);
    assert_eq!(people_json["items"][0]["personId"], "person-a");
    assert_eq!(people_json["items"][0]["name"], "Ada");
    assert_eq!(people_json["items"][0]["faceCount"], 3);
    assert_eq!(people_json["items"][0]["globalFaceCount"], 4);

    let merged_faces_json = post_runtime_json(
        runtime,
        "/v1/faces/list-asset-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "personId": "person-a"
        }),
    );
    let merged_face = merged_faces_json["items"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["faceId"] == "face-b"))
        .expect("merged source face should be listed for target person");
    assert_eq!(merged_faces_json["total"], 3);
    assert_eq!(merged_face["personId"], "person-a");
    assert_eq!(merged_face["personName"], "Ada");
    assert_eq!(merged_face["assignedBy"], "merge");
}

#[test]
fn runtime_api_faces_suggests_people() {
    let fixture = Fixture::new("runtime_api_faces_suggests_people");
    let runtime_home_path = fixture.root.join("runtime-home");
    let root_path = fixture.root.join("local-root");
    let other_root_path = fixture.root.join("other-root");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fs::create_dir_all(&root_path).expect("Local Root should be created");
    fs::create_dir_all(&other_root_path).expect("other Local Root should be created");
    write_people_face_store(&runtime_home_path, &root_path, &other_root_path);

    let runtime = FauplayRuntime::with_runtime_home_path(runtime_home_path);
    let suggestions_json = post_runtime_json(
        runtime,
        "/v1/faces/suggest-people",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceId": "face-unassigned",
            "candidateSize": 2
        }),
    );

    assert_eq!(suggestions_json["ok"], true);
    assert_eq!(suggestions_json["faceId"], "face-unassigned");
    let suggestions = suggestions_json["items"]
        .as_array()
        .expect("suggestions should be an array");
    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0]["personId"], "person-a");
    assert_eq!(suggestions[0]["name"], "Ada");
    assert_eq!(suggestions[0]["supportingFace"]["faceId"], "face-a-outside");
    assert_eq!(
        suggestions[0]["supportingFace"]["assetPath"],
        other_root_path
            .join("photos/outside.jpg")
            .display()
            .to_string()
    );
    assert_eq!(suggestions[1]["personId"], "person-b");
    assert_eq!(suggestions[1]["supportingFace"]["faceId"], "face-b");
    assert_eq!(
        suggestions[1]["supportingFace"]["boundingBox"],
        serde_json::json!({ "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 })
    );
}

#[test]
fn runtime_api_faces_clusters_pending_faces() {
    let fixture = Fixture::new("runtime_api_faces_clusters_pending_faces");
    let runtime_home_path = fixture.root.join("runtime-home");
    let root_path = fixture.root.join("local-root");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fs::create_dir_all(&root_path).expect("Local Root should be created");
    write_cluster_face_store(&runtime_home_path, &root_path);

    let runtime = FauplayRuntime::with_runtime_home_path(runtime_home_path);
    let cluster_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/cluster-pending",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "limit": 10,
            "maxDistance": 0.01,
            "minFaces": 3
        }),
    );

    assert_eq!(cluster_json["ok"], true);
    assert_eq!(cluster_json["processed"], 4);
    assert_eq!(cluster_json["assigned"], 4);
    assert_eq!(cluster_json["createdPersons"], 1);
    assert_eq!(cluster_json["deferred"], 0);
    assert_eq!(cluster_json["skipped"], 0);
    assert_eq!(cluster_json["failed"], 0);

    let matched_faces_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/list-asset-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "relativePath": "photos/match.jpg"
        }),
    );
    assert_eq!(matched_faces_json["items"][0]["faceId"], "face-match");
    assert_eq!(matched_faces_json["items"][0]["status"], "assigned");
    assert_eq!(matched_faces_json["items"][0]["personId"], "person-a");
    assert_eq!(matched_faces_json["items"][0]["assignedBy"], "auto");

    let people_json = post_runtime_json(
        runtime,
        "/v1/faces/list-people",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "scope": "root",
            "page": 1,
            "size": 10
        }),
    );
    let people = people_json["items"]
        .as_array()
        .expect("people should be an array");
    let created_person = people
        .iter()
        .find(|person| person["personId"].as_str() != Some("person-a"))
        .expect("cluster should create one Person for a core pending group");
    assert_eq!(people_json["total"], 2);
    assert_eq!(created_person["name"], "");
    assert_eq!(created_person["faceCount"], 3);
    assert_eq!(created_person["globalFaceCount"], 3);
}

#[test]
fn runtime_api_faces_mutates_review_and_assignment_state() {
    let fixture = Fixture::new("runtime_api_faces_mutates_review_and_assignment_state");
    let runtime_home_path = fixture.root.join("runtime-home");
    let root_path = fixture.root.join("local-root");
    let other_root_path = fixture.root.join("other-root");
    fs::create_dir_all(&runtime_home_path).expect("runtime home should be created");
    fs::create_dir_all(&root_path).expect("Local Root should be created");
    fs::create_dir_all(&other_root_path).expect("other Local Root should be created");
    write_people_face_store(&runtime_home_path, &root_path, &other_root_path);

    let runtime = FauplayRuntime::with_runtime_home_path(runtime_home_path);
    let create_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/create-person-from-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-unassigned"],
            "name": "New Person"
        }),
    );

    assert_eq!(create_json["ok"], true);
    assert_eq!(create_json["action"], "createPersonFromFaces");
    assert_eq!(create_json["succeeded"], 1);
    assert_eq!(create_json["failed"], 0);
    let created_person_id = create_json["personId"]
        .as_str()
        .expect("create-person-from-faces should return a personId")
        .to_owned();
    assert_eq!(
        create_json["items"][0]["nextPersonId"],
        serde_json::Value::String(created_person_id.clone())
    );

    let created_faces_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/list-asset-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "personId": created_person_id
        }),
    );
    assert_eq!(created_faces_json["total"], 1);
    assert_eq!(created_faces_json["items"][0]["faceId"], "face-unassigned");
    assert_eq!(created_faces_json["items"][0]["personName"], "New Person");

    let assign_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/assign-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-b"],
            "targetPersonId": "person-a"
        }),
    );
    assert_eq!(assign_json["ok"], true);
    assert_eq!(assign_json["action"], "assignFaces");
    assert_eq!(assign_json["items"][0]["previousPersonId"], "person-b");
    assert_eq!(assign_json["items"][0]["nextStatus"], "assigned");
    assert_eq!(assign_json["items"][0]["nextPersonId"], "person-a");

    let unassign_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/unassign-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-b"]
        }),
    );
    assert_eq!(unassign_json["ok"], true);
    assert_eq!(unassign_json["action"], "unassignFaces");
    assert_eq!(unassign_json["items"][0]["previousPersonId"], "person-a");
    assert_eq!(unassign_json["items"][0]["nextStatus"], "manual_unassigned");
    assert_eq!(
        unassign_json["items"][0]["nextPersonId"],
        serde_json::Value::Null
    );

    let ignore_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/ignore-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-b", "missing-face"]
        }),
    );
    assert_eq!(ignore_json["ok"], true);
    assert_eq!(ignore_json["action"], "ignoreFaces");
    assert_eq!(ignore_json["succeeded"], 1);
    assert_eq!(ignore_json["failed"], 1);
    assert_eq!(ignore_json["items"][0]["nextStatus"], "ignored");
    assert_eq!(ignore_json["items"][1]["reasonCode"], "FACE_NOT_FOUND");

    let assign_ignored_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/assign-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-b"],
            "targetPersonId": "person-a"
        }),
    );
    assert_eq!(assign_ignored_json["ok"], true);
    assert_eq!(assign_ignored_json["succeeded"], 0);
    assert_eq!(assign_ignored_json["failed"], 1);
    assert_eq!(assign_ignored_json["items"][0]["previousStatus"], "ignored");
    assert_eq!(
        assign_ignored_json["items"][0]["reasonCode"],
        "FACE_STATE_CONFLICT"
    );

    let restore_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/restore-ignored-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-b"]
        }),
    );
    assert_eq!(restore_json["ok"], true);
    assert_eq!(restore_json["action"], "restoreIgnoredFaces");
    assert_eq!(restore_json["items"][0]["previousStatus"], "ignored");
    assert_eq!(restore_json["items"][0]["nextStatus"], "manual_unassigned");

    let requeue_json = post_runtime_json(
        runtime.clone(),
        "/v1/faces/requeue-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "faceIds": ["face-b"]
        }),
    );
    assert_eq!(requeue_json["ok"], true);
    assert_eq!(requeue_json["action"], "requeueFaces");
    assert_eq!(
        requeue_json["items"][0]["previousStatus"],
        "manual_unassigned"
    );
    assert_eq!(requeue_json["items"][0]["nextStatus"], "deferred");

    let review_json = post_runtime_json(
        runtime,
        "/v1/faces/list-review-faces",
        serde_json::json!({
            "rootPath": root_path.display().to_string(),
            "bucket": "unassigned",
            "page": 1,
            "size": 10
        }),
    );
    assert!(
        review_json["items"]
            .as_array()
            .expect("review items should be an array")
            .iter()
            .any(|item| item["faceId"] == "face-b" && item["status"] == "deferred"),
        "requeued face should be visible in the unassigned review bucket: {review_json}"
    );
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

fn write_cluster_face_store(runtime_home_path: &Path, root_path: &Path) {
    let store_path = runtime_home_path.join("global").join("faces.v1.json");
    fs::create_dir_all(store_path.parent().unwrap()).expect("face store parent should be created");
    fs::write(
        store_path,
        serde_json::json!({
            "version": 1,
            "faces": [
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/ada.jpg",
                    "assetId": "asset-a",
                    "faceId": "face-a",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.4 },
                    "score": 0.91,
                    "status": "assigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": "person-a",
                    "personName": "Ada",
                    "assignedBy": "manual",
                    "updatedAt": 10,
                    "embedding": [1.0, 0.0]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/match.jpg",
                    "assetId": "asset-match",
                    "faceId": "face-match",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.88,
                    "status": "unassigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": null,
                    "personName": null,
                    "assignedBy": null,
                    "updatedAt": 20,
                    "embedding": [0.99, 0.01]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/new-1.jpg",
                    "assetId": "asset-new-1",
                    "faceId": "face-new-1",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.82,
                    "status": "unassigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": null,
                    "personName": null,
                    "assignedBy": null,
                    "updatedAt": 30,
                    "embedding": [0.0, 1.0]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/new-2.jpg",
                    "assetId": "asset-new-2",
                    "faceId": "face-new-2",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.83,
                    "status": "deferred",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": null,
                    "personName": null,
                    "assignedBy": null,
                    "updatedAt": 40,
                    "embedding": [0.0, 0.99]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/new-3.jpg",
                    "assetId": "asset-new-3",
                    "faceId": "face-new-3",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.84,
                    "status": "unassigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": null,
                    "personName": null,
                    "assignedBy": null,
                    "updatedAt": 50,
                    "embedding": [0.0, 0.98]
                },
                {
                    "rootPath": root_path.display().to_string(),
                    "rootRelativePath": "photos/far.jpg",
                    "assetId": "asset-far",
                    "faceId": "face-far",
                    "boundingBox": { "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.5 },
                    "score": 0.8,
                    "status": "manual_unassigned",
                    "mediaType": "image",
                    "frameTsMs": null,
                    "personId": null,
                    "personName": null,
                    "assignedBy": null,
                    "updatedAt": 60,
                    "embedding": [-1.0, 0.0]
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

fn post_runtime_json(
    runtime: FauplayRuntime,
    path: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let body = body.to_string();
    let (address, server) = serve_runtime_once(runtime);
    let response = send_json_request(&address, "POST", path, &body);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "{path} should be handled by the Rust Runtime: {response}"
    );
    response_json(&response)
}

fn response_json(response: &str) -> serde_json::Value {
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .expect("HTTP response should contain a body separator");
    serde_json::from_str(body).expect("HTTP response body should be JSON")
}
