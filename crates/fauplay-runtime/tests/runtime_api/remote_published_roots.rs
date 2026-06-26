use std::fs;

use sha2::{Digest, Sha256};

use super::support::*;

#[test]
fn runtime_api_lists_resolved_remote_published_roots_from_runtime_home() {
    let fixture =
        Fixture::new("runtime_api_lists_resolved_remote_published_roots_from_runtime_home");
    fixture.create_dir("Published Root");
    fixture.write_file("not-a-directory.txt", "not a directory");

    let published_root_path = fixture.root.join("Published Root");
    let missing_root_path = fixture.root.join("Missing Root");
    let file_root_path = fixture.root.join("not-a-directory.txt");
    let published_root_json = json_path(&published_root_path);
    let missing_root_json = json_path(&missing_root_path);
    let file_root_json = json_path(&file_root_path);
    let published_root_id = remote_root_id_for_path(&published_root_json);
    let runtime_home_path = fixture.root.join(".runtime-home");

    fixture.write_file(
        ".runtime-home/global/remote-published-roots.v1.json",
        &format!(
            r#"{{
  "version": 1,
  "items": [
    {{
      "id": "{published_root_id}",
      "label": "Runtime Published Root",
      "absolutePath": "{published_root_json}",
      "createdAtMs": 10,
      "lastSyncedAtMs": 20
    }},
    {{
      "id": "ignored-missing",
      "label": "Missing Root",
      "absolutePath": "{missing_root_json}",
      "createdAtMs": 30,
      "lastSyncedAtMs": 40
    }},
    {{
      "id": "ignored-file",
      "label": "File Root",
      "absolutePath": "{file_root_json}",
      "createdAtMs": 50,
      "lastSyncedAtMs": 60
    }},
    {{
      "id": "ignored-relative",
      "label": "Relative Root",
      "absolutePath": "relative/path",
      "createdAtMs": 70,
      "lastSyncedAtMs": 80
    }}
  ]
}}"#,
        ),
    );

    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_published_roots_resolved_request(address)
    });

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "resolved roots response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "resolved roots response should report success: {response}"
    );
    assert!(
        response.contains(&format!("\"id\":\"{published_root_id}\"")),
        "resolved roots response should include the valid Remote Root: {response}"
    );
    assert!(
        response.contains("\"label\":\"Runtime Published Root\"")
            && response.contains(&format!("\"absolutePath\":\"{published_root_json}\""))
            && response.contains("\"realPath\":"),
        "resolved roots response should include host paths for gateway hydration: {response}"
    );
    assert!(
        !response.contains("Missing Root")
            && !response.contains("File Root")
            && !response.contains("Relative Root"),
        "resolved roots response should skip stale or invalid Remote Roots: {response}"
    );
}

#[test]
fn runtime_api_lists_remote_shared_favorites_from_runtime_home() {
    let fixture = Fixture::new("runtime_api_lists_remote_shared_favorites_from_runtime_home");
    fixture.write_file(
        "global/remote-shared-favorites.v1.json",
        r#"{
  "version": 1,
  "items": [
    {"rootId":"root-a","path":"albums/2026","favoritedAtMs":20},
    {"rootId":"root-b","path":"","favoritedAtMs":10},
    {"rootId":"","path":"ignored","favoritedAtMs":30},
    {"rootId":"root-a","path":"../unsafe","favoritedAtMs":40}
  ]
}"#,
    );

    let response = send_runtime_home_request_once(&fixture.root, |address| {
        send_remote_shared_favorites_list_request(address)
    });

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "list response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "list response should report success: {response}"
    );
    assert!(
        response.contains("\"rootId\":\"root-a\""),
        "list response should include valid favorites: {response}"
    );
    assert!(
        response.contains("\"path\":\"albums/2026\""),
        "list response should include valid favorite paths: {response}"
    );
    assert!(
        response.contains("\"path\":\"\""),
        "list response should include the Local Root favorite: {response}"
    );
    assert!(
        !response.contains("ignored") && !response.contains("unsafe"),
        "list response should skip invalid favorites: {response}"
    );
}

#[test]
fn runtime_api_upserts_and_removes_remote_shared_favorites() {
    let fixture = Fixture::new("runtime_api_upserts_and_removes_remote_shared_favorites");
    fixture.write_file(
        "global/remote-shared-favorites.v1.json",
        r#"{
  "version": 1,
  "items": [
    {"rootId":"root-a","path":"albums/old","favoritedAtMs":10}
  ]
}"#,
    );

    let upsert_body = r#"{"rootId":" root-a ","path":"albums\\new","favoritedAtMs":50}"#;
    let response = send_runtime_home_request_once(&fixture.root, |address| {
        send_remote_shared_favorite_upsert_request(address, upsert_body)
    });
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "upsert response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootId\":\"root-a\"")
            && response.contains("\"path\":\"albums/new\"")
            && response.contains("\"favoritedAtMs\":50"),
        "upsert response should include the normalized favorite: {response}"
    );

    let remove_body = r#"{"rootId":"root-a","path":"albums/old"}"#;
    let response = send_runtime_home_request_once(&fixture.root, |address| {
        send_remote_shared_favorite_remove_request(address, remove_body)
    });
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "remove response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "remove response should report success: {response}"
    );

    let response = send_runtime_home_request_once(&fixture.root, |address| {
        send_remote_shared_favorites_list_request(address)
    });
    assert!(
        response.contains("\"path\":\"albums/new\""),
        "list response should keep the upserted favorite: {response}"
    );
    assert!(
        !response.contains("albums/old"),
        "list response should remove the deleted favorite: {response}"
    );
}

#[test]
fn runtime_api_syncs_remote_published_roots_from_local_browser() {
    let fixture = Fixture::new("runtime_api_syncs_remote_published_roots_from_local_browser");
    fixture.create_dir("Library Root");
    let root_path = fixture.root.join("Library Root");
    let runtime_home_path = fixture.root.join(".runtime-home");
    let body = format!(
        r#"[
  {{
    "label": "  Photos   Library  ",
    "absolutePath": "{}",
    "favoritePaths": ["albums/2026", "../unsafe", "clips\\raw"]
  }},
  {{
    "label": "Ignored relative",
    "absolutePath": "relative/path",
    "favoritePaths": ["ignored"]
  }}
]"#,
        json_path(&root_path),
    );

    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_published_roots_sync_request(address, &body)
    });

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "sync response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "sync response should report success: {response}"
    );
    assert!(
        response.contains("\"publishedRootCount\":1"),
        "sync response should report the accepted root count: {response}"
    );

    let published = read_runtime_home_json(&runtime_home_path, "remote-published-roots.v1.json");
    let roots = published
        .get("items")
        .and_then(serde_json::Value::as_array)
        .expect("published roots should contain items");
    assert_eq!(roots.len(), 1);

    let root = roots[0]
        .as_object()
        .expect("published root should be an object");
    let root_id = root
        .get("id")
        .and_then(serde_json::Value::as_str)
        .expect("published root should have an id");
    assert!(root_id.starts_with("remote-root-"));
    assert_eq!(root_id.len(), "remote-root-".len() + 24);
    assert_eq!(
        root.get("label").and_then(serde_json::Value::as_str),
        Some("Photos Library"),
    );
    let expected_root_path = root_path.to_string_lossy().replace('\\', "/");
    assert_eq!(
        root.get("absolutePath").and_then(serde_json::Value::as_str),
        Some(expected_root_path.as_str()),
    );

    let favorites = read_runtime_home_json(&runtime_home_path, "remote-shared-favorites.v1.json");
    let favorite_items = favorites
        .get("items")
        .and_then(serde_json::Value::as_array)
        .expect("shared favorites should contain items");
    assert_eq!(favorite_items.len(), 2);
    let favorite_pairs = favorite_items
        .iter()
        .map(|item| {
            let object = item.as_object().expect("favorite should be an object");
            (
                object
                    .get("rootId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                object
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect::<Vec<_>>();
    assert!(favorite_pairs.contains(&(root_id.to_owned(), "albums/2026".to_owned())));
    assert!(favorite_pairs.contains(&(root_id.to_owned(), "clips/raw".to_owned())));
}

#[test]
fn runtime_api_remote_published_root_sync_removes_stale_shared_favorites() {
    let fixture =
        Fixture::new("runtime_api_remote_published_root_sync_removes_stale_shared_favorites");
    fixture.create_dir("Kept Root");
    fixture.create_dir("Removed Root");
    let kept_root_path = fixture.root.join("Kept Root");
    let removed_root_path = fixture.root.join("Removed Root");
    let kept_root_path_json = json_path(&kept_root_path);
    let removed_root_path_json = json_path(&removed_root_path);
    let kept_root_id = remote_root_id_for_path(&kept_root_path_json);
    let removed_root_id = remote_root_id_for_path(&removed_root_path_json);
    let runtime_home_path = fixture.root.join(".runtime-home");

    fixture.write_file(
        ".runtime-home/global/remote-published-roots.v1.json",
        &format!(
            r#"{{
  "version": 1,
  "items": [
    {{
      "id": "{kept_root_id}",
      "label": "Old Kept",
      "absolutePath": "{kept_root_path_json}",
      "createdAtMs": 111,
      "lastSyncedAtMs": 222
    }},
    {{
      "id": "{removed_root_id}",
      "label": "Removed",
      "absolutePath": "{removed_root_path_json}",
      "createdAtMs": 333,
      "lastSyncedAtMs": 444
    }}
  ]
}}"#,
        ),
    );
    fixture.write_file(
        ".runtime-home/global/remote-shared-favorites.v1.json",
        &format!(
            r#"{{
  "version": 1,
  "items": [
    {{"rootId":"{kept_root_id}","path":"existing","favoritedAtMs":10}},
    {{"rootId":"{removed_root_id}","path":"stale","favoritedAtMs":20}}
  ]
}}"#,
        ),
    );

    let body = format!(
        r#"[{{"label":"Kept","absolutePath":"{kept_root_path_json}","favoritePaths":["fresh"]}}]"#,
    );
    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_published_roots_sync_request(address, &body)
    });

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "sync response should be OK: {response}"
    );
    assert!(
        response.contains("\"publishedRootCount\":1"),
        "sync response should report one remaining root: {response}"
    );

    let published = read_runtime_home_json(&runtime_home_path, "remote-published-roots.v1.json");
    let roots = published
        .get("items")
        .and_then(serde_json::Value::as_array)
        .expect("published roots should contain items");
    assert_eq!(roots.len(), 1);
    let root = roots[0]
        .as_object()
        .expect("published root should be an object");
    assert_eq!(
        root.get("id").and_then(serde_json::Value::as_str),
        Some(kept_root_id.as_str()),
    );
    assert_eq!(
        root.get("createdAtMs").and_then(serde_json::Value::as_u64),
        Some(111),
    );
    assert!(
        root.get("lastSyncedAtMs")
            .and_then(serde_json::Value::as_u64)
            .is_some_and(|value| value > 222),
        "sync should refresh lastSyncedAtMs: {root:?}"
    );

    let favorites = read_runtime_home_json(&runtime_home_path, "remote-shared-favorites.v1.json");
    let favorite_pairs = favorite_pairs(&favorites);
    assert!(favorite_pairs.contains(&(kept_root_id.clone(), "existing".to_owned())));
    assert!(favorite_pairs.contains(&(kept_root_id.clone(), "fresh".to_owned())));
    assert!(
        !favorite_pairs
            .iter()
            .any(|(root_id, _)| root_id == &removed_root_id),
        "sync should remove favorites for unpublished roots: {favorite_pairs:?}"
    );
}

fn read_runtime_home_json(
    runtime_home_path: &std::path::Path,
    file_name: &str,
) -> serde_json::Value {
    let raw = fs::read_to_string(runtime_home_path.join("global").join(file_name))
        .expect("Runtime Home JSON file should exist");
    serde_json::from_str(&raw).expect("Runtime Home JSON should parse")
}

fn favorite_pairs(favorites: &serde_json::Value) -> Vec<(String, String)> {
    favorites
        .get("items")
        .and_then(serde_json::Value::as_array)
        .expect("shared favorites should contain items")
        .iter()
        .map(|item| {
            let object = item.as_object().expect("favorite should be an object");
            (
                object
                    .get("rootId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                object
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect()
}

fn remote_root_id_for_path(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let digest = hasher.finalize();
    let hash = digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("remote-root-{hash}")
}
