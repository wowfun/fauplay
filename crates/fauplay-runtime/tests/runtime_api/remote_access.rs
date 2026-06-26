use super::support::*;

use serde_json::Value;
use sha2::{Digest, Sha256};

#[test]
fn runtime_api_remote_session_login_authorize_and_logout_use_runtime_cookies() {
    let fixture =
        Fixture::new("runtime_api_remote_session_login_authorize_and_logout_use_runtime_cookies");
    let runtime_home_path = fixture.root.join(".runtime-home");
    fixture.write_file(
        ".runtime-home/global/.env",
        "FAUPLAY_REMOTE_ACCESS_TOKEN=secret-token\n",
    );

    let runtime = fauplay_runtime::FauplayRuntime::with_runtime_home_path(&runtime_home_path);
    let (address, server) = serve_runtime_once(runtime.clone());
    let login_response = send_remote_session_login_request(
        &address,
        "Bearer secret-token",
        None,
        Some("FauplayTest Chrome/126 Linux"),
        "{}",
    );
    server.join().expect("server thread should finish");

    assert!(
        login_response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "valid bearer login should issue a Remote Access session: {login_response}"
    );
    let session_cookie = response_cookie(&login_response, "__Host-fauplay-remote-session")
        .expect("login response should include a Remote Access session cookie");
    assert!(
        session_cookie.contains("HttpOnly")
            && session_cookie.contains("Secure")
            && session_cookie.contains("SameSite=Strict"),
        "session cookie should use host-only secure attributes: {session_cookie}"
    );
    let session_cookie_pair = cookie_pair(&session_cookie);

    let (address, server) = serve_runtime_once(runtime.clone());
    let authorize_response =
        send_remote_session_authorize_request(&address, Some(&session_cookie_pair));
    server.join().expect("server thread should finish");
    assert!(
        authorize_response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "session cookie should authorize Remote Access requests: {authorize_response}"
    );

    let (address, server) = serve_runtime_once(runtime.clone());
    let logout_response =
        send_remote_session_logout_request(&address, Some(&session_cookie_pair), "{}");
    server.join().expect("server thread should finish");
    assert!(
        logout_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "logout should clear the Remote Access session: {logout_response}"
    );
    let expired_session_cookie = response_cookie(&logout_response, "__Host-fauplay-remote-session")
        .expect("logout should expire the session cookie");
    assert!(
        expired_session_cookie.contains("Max-Age=0"),
        "logout should expire the session cookie: {expired_session_cookie}"
    );

    let (address, server) = serve_runtime_once(runtime);
    let stale_authorize_response =
        send_remote_session_authorize_request(&address, Some(&session_cookie_pair));
    server.join().expect("server thread should finish");
    assert!(
        stale_authorize_response.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "logged-out session cookie should no longer authorize: {stale_authorize_response}"
    );
}

#[test]
fn runtime_api_remote_session_rotates_remembered_device_cookie() {
    let fixture = Fixture::new("runtime_api_remote_session_rotates_remembered_device_cookie");
    let runtime_home_path = fixture.root.join(".runtime-home");
    fixture.write_file(
        ".runtime-home/global/.env",
        "FAUPLAY_REMOTE_ACCESS_TOKEN=secret-token\n",
    );

    let runtime = fauplay_runtime::FauplayRuntime::with_runtime_home_path(&runtime_home_path);
    let (address, server) = serve_runtime_once(runtime.clone());
    let login_response = send_remote_session_login_request(
        &address,
        "Bearer secret-token",
        None,
        Some("FauplayTest Chrome/126 Linux"),
        r#"{"rememberDevice":true,"rememberDeviceLabel":" Desk   Device "}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        login_response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "remembered login should succeed: {login_response}"
    );
    let remember_cookie = response_cookie(&login_response, "__Host-fauplay-remote-remember-device")
        .expect("remembered login should include a Remembered Device cookie");
    let remember_cookie_pair = cookie_pair(&remember_cookie);

    let (address, server) = serve_runtime_once(runtime);
    let authorize_response =
        send_remote_session_authorize_request(&address, Some(&remember_cookie_pair));
    server.join().expect("server thread should finish");
    assert!(
        authorize_response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "Remembered Device cookie should authorize Remote Access requests: {authorize_response}"
    );
    let rotated_remember_cookie =
        response_cookie(&authorize_response, "__Host-fauplay-remote-remember-device")
            .expect("Remembered Device authorization should rotate the device cookie");
    assert_ne!(
        cookie_pair(&rotated_remember_cookie),
        remember_cookie_pair,
        "Remembered Device cookie should rotate on authorization"
    );
    assert!(
        response_cookie(&authorize_response, "__Host-fauplay-remote-session").is_some(),
        "Remembered Device authorization should also issue a fresh session cookie"
    );
}

#[test]
fn runtime_api_remote_roots_are_session_protected_and_hide_host_paths() {
    let fixture =
        Fixture::new("runtime_api_remote_roots_are_session_protected_and_hide_host_paths");
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
        "FAUPLAY_REMOTE_ACCESS_TOKEN=secret-token\n",
    );

    let runtime = fauplay_runtime::FauplayRuntime::with_runtime_home_path(&runtime_home_path);
    let (address, server) = serve_runtime_once(runtime.clone());
    let unauthorized_response = send_remote_roots_request(&address, None);
    server.join().expect("server thread should finish");
    assert!(
        unauthorized_response.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "Remote Roots should require a Remote Access session: {unauthorized_response}"
    );

    let session_cookie_pair = login_remote_session_cookie_pair(runtime.clone());
    let (address, server) = serve_runtime_once(runtime);
    let response = send_remote_roots_request(&address, Some(&session_cookie_pair));
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Roots should be served by the Runtime: {response}"
    );
    let payload = response_json(&response);
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["items"][0]["id"], "shared-root");
    assert_eq!(payload["items"][0]["label"], "Shared Root");
    assert!(
        payload["items"][0].get("path").is_none() && payload["items"][0].get("realPath").is_none(),
        "Remote Roots response must not expose host paths: {payload}"
    );
}

#[test]
fn runtime_api_remote_file_list_resolves_remote_roots_and_projects_listing_items() {
    let fixture = Fixture::new(
        "runtime_api_remote_file_list_resolves_remote_roots_and_projects_listing_items",
    );
    fixture.create_dir("Shared Root/albums/nested");
    fixture.write_file("Shared Root/albums/runtime-only.jpg", "runtime image");
    fixture.write_file("Shared Root/albums/nested/clip.mp4", "runtime video");
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
        "FAUPLAY_REMOTE_ACCESS_TOKEN=secret-token\n",
    );

    let runtime = fauplay_runtime::FauplayRuntime::with_runtime_home_path(&runtime_home_path);
    let session_cookie_pair = login_remote_session_cookie_pair(runtime.clone());
    let (address, server) = serve_runtime_once(runtime.clone());
    let response = send_remote_file_list_request(
        &address,
        Some(&session_cookie_pair),
        r#"{"rootId":"shared-root","path":"albums","flattenView":false}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Listing should be served by the Runtime: {response}"
    );
    let payload = response_json(&response);
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["rootId"], "shared-root");
    assert_eq!(payload["path"], "albums");
    assert_eq!(payload["flattenView"], false);
    assert_eq!(payload["items"][0]["name"], "nested");
    assert_eq!(payload["items"][0]["path"], "albums/nested");
    assert_eq!(payload["items"][0]["kind"], "directory");
    assert_eq!(payload["items"][0]["displayPath"], "albums/nested");
    assert_eq!(payload["items"][0]["isEmpty"], false);
    assert_eq!(payload["items"][0]["entryCount"], 1);
    assert_eq!(payload["items"][1]["name"], "runtime-only.jpg");
    assert_eq!(payload["items"][1]["path"], "albums/runtime-only.jpg");
    assert_eq!(payload["items"][1]["kind"], "file");
    assert_eq!(payload["items"][1]["mimeType"], "image/jpeg");
    assert_eq!(payload["items"][1]["previewKind"], "image");
    assert_eq!(
        payload["items"][1]["displayPath"],
        "albums/runtime-only.jpg"
    );
    assert_eq!(payload["isTruncated"], false);
    assert!(payload["nextOffset"].is_null());
    assert!(
        !response.contains(&shared_root_json),
        "Remote Listing response must not expose Remote Root host paths: {response}"
    );

    let (address, server) = serve_runtime_once(runtime);
    let escape_response = send_remote_file_list_request(
        &address,
        Some(&session_cookie_pair),
        r#"{"rootId":"shared-root","path":"../outside","flattenView":false}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        escape_response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
        "Remote Listing should reject unsafe Root-relative Paths: {escape_response}"
    );
}

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

fn response_cookie(response: &str, cookie_name: &str) -> Option<String> {
    response
        .lines()
        .filter_map(|line| line.strip_prefix("Set-Cookie: "))
        .find(|value| value.starts_with(&format!("{cookie_name}=")))
        .map(ToOwned::to_owned)
}

fn cookie_pair(set_cookie: &str) -> String {
    set_cookie
        .split(';')
        .next()
        .expect("Set-Cookie should contain a cookie pair")
        .to_owned()
}

fn login_remote_session_cookie_pair(runtime: fauplay_runtime::FauplayRuntime) -> String {
    let (address, server) = serve_runtime_once(runtime);
    let login_response = send_remote_session_login_request(
        &address,
        "Bearer secret-token",
        None,
        Some("FauplayTest Chrome/126 Linux"),
        "{}",
    );
    server.join().expect("server thread should finish");
    let session_cookie = response_cookie(&login_response, "__Host-fauplay-remote-session")
        .expect("login response should include a Remote Access session cookie");
    cookie_pair(&session_cookie)
}

fn response_json(response: &str) -> Value {
    let body = response
        .split("\r\n\r\n")
        .nth(1)
        .expect("HTTP response should contain a body");
    serde_json::from_str(body).expect("HTTP response body should be JSON")
}
