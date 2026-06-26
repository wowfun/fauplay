use super::support::*;

use sha2::{Digest, Sha256};

#[test]
fn runtime_api_returns_remote_access_config_without_exposing_token() {
    let fixture = Fixture::new("runtime_api_returns_remote_access_config_without_exposing_token");
    fixture.create_dir("Shared Root");
    let shared_root_path = fixture.root.join("Shared Root");
    let runtime_home_path = fixture.root.join(".runtime-home");
    let shared_root_json = json_path(&shared_root_path);

    fixture.write_file(
        ".runtime-home/global/remote-access.json",
        &format!(
            r#"{{
  "enabled": true,
  "rootSource": "manual",
  "roots": [
    {{
      "id": "shared-root",
      "label": "Shared Root",
      "path": "{shared_root_json}"
    }}
  ]
}}"#,
        ),
    );
    fixture.write_file(
        ".runtime-home/global/.env",
        "FAUPLAY_REMOTE_ACCESS_TOKEN=\"secret-token\"\n",
    );

    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_access_config_request(address)
    });

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Access config response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true")
            && response.contains("\"enabled\":true")
            && response.contains("\"configured\":true")
            && response.contains("\"authConfigured\":true")
            && response.contains("\"rootSource\":\"manual\""),
        "Remote Access config should report enabled manual access: {response}"
    );
    assert!(
        response.contains("\"id\":\"shared-root\"")
            && response.contains("\"label\":\"Shared Root\"")
            && response.contains(&format!("\"path\":\"{shared_root_json}\""))
            && response.contains("\"realPath\":"),
        "Remote Access config should include the resolved Remote Root: {response}"
    );
    assert!(
        !response.contains("secret-token"),
        "Remote Access config must not expose the bearer token: {response}"
    );
}

#[test]
fn runtime_api_verifies_remote_access_bearer_tokens() {
    let fixture = Fixture::new("runtime_api_verifies_remote_access_bearer_tokens");
    let runtime_home_path = fixture.root.join(".runtime-home");
    fixture.write_file(
        ".runtime-home/global/.env",
        "FAUPLAY_REMOTE_ACCESS_TOKEN='secret-token'\n",
    );

    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_access_authorize_request(address, r#"{"bearerToken":" secret-token "}"#)
    });
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "matching bearer token should authorize: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "matching bearer token should report ok: {response}"
    );

    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_access_authorize_request(address, r#"{"bearerToken":"wrong-token"}"#)
    });
    assert!(
        response.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "wrong bearer token should be rejected: {response}"
    );
    assert!(
        response.contains("\"code\":\"REMOTE_UNAUTHORIZED\""),
        "wrong bearer token should use the Remote Access unauthorized code: {response}"
    );
}

#[test]
fn runtime_api_resolves_remote_access_roots_from_local_browser_sync() {
    let fixture = Fixture::new("runtime_api_resolves_remote_access_roots_from_local_browser_sync");
    fixture.create_dir("Published Root");
    let published_root_path = fixture.root.join("Published Root");
    let runtime_home_path = fixture.root.join(".runtime-home");
    let published_root_json = json_path(&published_root_path);
    let published_root_id = remote_root_id_for_path(&published_root_json);

    fixture.write_file(
        ".runtime-home/global/.env",
        "FAUPLAY_REMOTE_ACCESS_TOKEN=secret-token\n",
    );
    fixture.write_file(
        ".runtime-home/global/remote-access.json",
        r#"{"enabled":true,"rootSource":"local-browser-sync","roots":[]}"#,
    );
    fixture.write_file(
        ".runtime-home/global/remote-published-roots.v1.json",
        &format!(
            r#"{{
  "version": 1,
  "items": [
    {{
      "id": "{published_root_id}",
      "label": "Synced Root",
      "absolutePath": "{published_root_json}",
      "createdAtMs": 10,
      "lastSyncedAtMs": 20
    }}
  ]
}}"#,
        ),
    );

    let response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_remote_access_config_request(address)
    });

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Access config response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootSource\":\"local-browser-sync\""),
        "Remote Access config should preserve the root source: {response}"
    );
    assert!(
        response.contains(&format!("\"id\":\"{published_root_id}\""))
            && response.contains("\"label\":\"Synced Root\"")
            && response.contains(&format!("\"path\":\"{published_root_json}\"")),
        "Remote Access config should include Runtime-resolved published roots: {response}"
    );
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
