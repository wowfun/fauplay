use super::support::*;

use fauplay_runtime::{FileAnnotationTagBindingRequest, RootRelativePath};
use serde_json::Value;
use sha2::{Digest, Sha256};

const FACE_CROP_SOURCE_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0,
    0, 0, 38, 147, 9, 41, 0, 0, 0, 40, 73, 68, 65, 84, 120, 156, 77, 201, 65, 17, 0, 48, 16, 131,
    64, 164, 157, 180, 72, 139, 51, 154, 103, 127, 204, 130, 224, 97, 176, 44, 57, 137, 116, 252,
    13, 81, 219, 38, 25, 63, 73, 43, 23, 50, 166, 241, 103, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174,
    66, 96, 130,
];

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
fn runtime_api_remote_file_content_serves_ranges_and_rejects_invalid_ranges() {
    let fixture =
        Fixture::new("runtime_api_remote_file_content_serves_ranges_and_rejects_invalid_ranges");
    fixture.create_dir("Shared Root");
    fixture.write_file("Shared Root/sample.txt", "abcdef");
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
    let query = "rootId=shared-root&relativePath=sample.txt";
    let (address, server) = serve_runtime_once(runtime.clone());
    let response = send_remote_file_content_request(
        &address,
        Some(&session_cookie_pair),
        query,
        Some("bytes=1-3"),
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 206 Partial Content\r\n"),
        "Remote File Content should serve byte ranges: {response}"
    );
    assert_eq!(
        response_header(&response, "Content-Type").as_deref(),
        Some("text/plain; charset=utf-8")
    );
    assert_eq!(
        response_header(&response, "Content-Range").as_deref(),
        Some("bytes 1-3/6")
    );
    assert_eq!(
        response_header(&response, "Cache-Control").as_deref(),
        Some("private, no-store")
    );
    assert!(
        response_header(&response, "Last-Modified").is_some(),
        "Remote File Content should expose Last-Modified for cache validation: {response}"
    );
    assert_eq!(response_body(&response), "bcd");

    let (address, server) = serve_runtime_once(runtime);
    let invalid_response = send_remote_file_content_request(
        &address,
        Some(&session_cookie_pair),
        query,
        Some("bytes=99-100"),
    );
    server.join().expect("server thread should finish");
    assert!(
        invalid_response.starts_with("HTTP/1.1 416 Range Not Satisfiable\r\n"),
        "Remote File Content should reject invalid ranges before streaming: {invalid_response}"
    );
    assert_eq!(
        response_header(&invalid_response, "Content-Range").as_deref(),
        Some("bytes */6")
    );
    assert_eq!(response_body(&invalid_response), "");
}

#[test]
fn runtime_api_remote_text_preview_resolves_remote_roots_without_absolute_paths() {
    let fixture = Fixture::new(
        "runtime_api_remote_text_preview_resolves_remote_roots_without_absolute_paths",
    );
    fixture.create_dir("Shared Root");
    fixture.write_file("Shared Root/sample.txt", "runtime preview content");
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
    let (address, server) = serve_runtime_once(runtime);
    let response = send_remote_text_preview_request(
        &address,
        Some(&session_cookie_pair),
        r#"{"rootId":"shared-root","relativePath":"sample.txt","sizeLimitBytes":64}"#,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Text Preview should be served by the Runtime: {response}"
    );
    let payload = response_json(&response);
    assert_eq!(payload["status"], "ready");
    assert_eq!(payload["content"], "runtime preview content");
    assert_eq!(payload["fileSizeBytes"], 23);
    assert_eq!(payload["sizeLimitBytes"], 64);
    assert!(
        !response.contains(&shared_root_json),
        "Remote Text Preview response must not expose host paths: {response}"
    );
}

#[test]
fn runtime_api_remote_thumbnail_rejects_sources_over_remote_budget() {
    let fixture = Fixture::new("runtime_api_remote_thumbnail_rejects_sources_over_remote_budget");
    fixture.create_dir("Shared Root");
    let large_source_path = fixture.root.join("Shared Root/large.bin");
    std::fs::File::create(&large_source_path)
        .expect("large fixture source should be created")
        .set_len(33 * 1024 * 1024)
        .expect("large fixture source should be sized");
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
    let (address, server) = serve_runtime_once(runtime);
    let response = send_remote_thumbnail_request(
        &address,
        Some(&session_cookie_pair),
        "rootId=shared-root&relativePath=large.bin&sizePreset=small",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 422 Unprocessable Entity\r\n"),
        "Remote Thumbnail should reject sources over the remote budget: {response}"
    );
    assert!(
        response.contains("Thumbnail source exceeds remote budget"),
        "Remote Thumbnail budget errors should be explicit: {response}"
    );
}

#[cfg(unix)]
#[test]
fn runtime_api_remote_file_content_rejects_symlink_escape() {
    let fixture = Fixture::new("runtime_api_remote_file_content_rejects_symlink_escape");
    fixture.create_dir("Shared Root");
    fixture.write_file("outside.txt", "outside secret");
    std::os::unix::fs::symlink(
        fixture.root.join("outside.txt"),
        fixture.root.join("Shared Root/escape.txt"),
    )
    .expect("fixture symlink should be created");
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
    let (address, server) = serve_runtime_once(runtime);
    let response = send_remote_file_content_request(
        &address,
        Some(&session_cookie_pair),
        "rootId=shared-root&relativePath=escape.txt",
        None,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 403 Forbidden\r\n"),
        "Remote File Content should reject symlink escapes from a Remote Root: {response}"
    );
}

#[test]
fn runtime_api_remote_annotation_tags_resolve_remote_roots_without_host_paths() {
    let fixture =
        Fixture::new("runtime_api_remote_annotation_tags_resolve_remote_roots_without_host_paths");
    fixture.create_dir("Shared Root/albums");
    fixture.write_file("Shared Root/albums/photo.jpg", "image");
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
    runtime
        .bind_file_annotation_tag(FileAnnotationTagBindingRequest {
            root_path: shared_root_path.clone(),
            root_relative_path: RootRelativePath::try_from("albums/photo.jpg")
                .expect("fixture path should be Root-relative"),
            key: "rating".to_owned(),
            value: "5".to_owned(),
        })
        .expect("fixture Annotation Tag should be bound");

    let session_cookie_pair = login_remote_session_cookie_pair(runtime.clone());
    let (address, server) = serve_runtime_once(runtime.clone());
    let options_response = send_remote_tags_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/tags/options",
        r#"{"rootId":"shared-root"}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        options_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Annotation Tag options should be served by the Runtime: {options_response}"
    );
    let options_payload = response_json(&options_response);
    assert_eq!(options_payload["ok"], true);
    assert_eq!(options_payload["items"][0]["tagKey"], "rating=5");
    assert_eq!(options_payload["items"][0]["fileCount"], 1);

    let (address, server) = serve_runtime_once(runtime.clone());
    let query_response = send_remote_tags_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/tags/query",
        r#"{"rootId":"shared-root","includeTagKeys":["rating=5"],"includeMatchMode":"and","page":1,"size":10}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        query_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote File Annotation query should be served by the Runtime: {query_response}"
    );
    let query_payload = response_json(&query_response);
    assert_eq!(query_payload["ok"], true);
    assert_eq!(query_payload["total"], 1);
    assert_eq!(
        query_payload["items"][0]["relativePath"],
        "albums/photo.jpg"
    );
    assert!(query_payload["items"][0].get("absolutePath").is_none());

    let (address, server) = serve_runtime_once(runtime);
    let file_response = send_remote_tags_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/tags/file",
        r#"{"rootId":"shared-root","relativePath":"albums/photo.jpg"}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        file_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote File Annotation read should be served by the Runtime: {file_response}"
    );
    let file_payload = response_json(&file_response);
    assert_eq!(file_payload["ok"], true);
    assert_eq!(file_payload["file"]["relativePath"], "albums/photo.jpg");
    assert_eq!(file_payload["file"]["tags"][0]["key"], "rating");
    assert_eq!(file_payload["file"]["tags"][0]["value"], "5");
    assert!(file_payload["file"].get("absolutePath").is_none());
    assert!(
        !query_response.contains(&shared_root_json) && !file_response.contains(&shared_root_json),
        "Remote Annotation Tag responses must not expose Remote Root host paths"
    );
}

#[test]
fn runtime_api_remote_favorites_are_session_protected_and_resolve_remote_roots() {
    let fixture =
        Fixture::new("runtime_api_remote_favorites_are_session_protected_and_resolve_remote_roots");
    fixture.create_dir("Shared Root/albums");
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
    fixture.write_file(
        ".runtime-home/global/remote-shared-favorites.v1.json",
        r#"{
  "version": 1,
  "items": [
    {"rootId":"shared-root","path":"albums/old","favoritedAtMs":20},
    {"rootId":"stale-root","path":"stale","favoritedAtMs":30}
  ]
}"#,
    );

    let runtime = fauplay_runtime::FauplayRuntime::with_runtime_home_path(&runtime_home_path);
    let (address, server) = serve_runtime_once(runtime.clone());
    let unauthorized_response = send_remote_favorites_list_request(&address, None);
    server.join().expect("server thread should finish");
    assert!(
        unauthorized_response.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "Remote Favorites should require a Remote Access session: {unauthorized_response}"
    );

    let session_cookie_pair = login_remote_session_cookie_pair(runtime.clone());
    let (address, server) = serve_runtime_once(runtime.clone());
    let list_response = send_remote_favorites_list_request(&address, Some(&session_cookie_pair));
    server.join().expect("server thread should finish");
    assert!(
        list_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Favorites list should be served by the Runtime: {list_response}"
    );
    let list_payload = response_json(&list_response);
    assert_eq!(list_payload["ok"], true);
    assert_eq!(list_payload["items"].as_array().unwrap().len(), 1);
    assert_eq!(list_payload["items"][0]["rootId"], "shared-root");
    assert_eq!(list_payload["items"][0]["path"], "albums/old");
    assert_eq!(list_payload["items"][0]["favoritedAtMs"], 20);

    let (address, server) = serve_runtime_once(runtime.clone());
    let upsert_response = send_remote_favorite_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/favorites/upsert",
        r#"{"rootId":"shared-root","path":"albums\\new","favoritedAtMs":1}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        upsert_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Favorite upsert should be served by the Runtime: {upsert_response}"
    );
    let upsert_payload = response_json(&upsert_response);
    assert_eq!(upsert_payload["ok"], true);
    assert_eq!(upsert_payload["item"]["rootId"], "shared-root");
    assert_eq!(upsert_payload["item"]["path"], "albums/new");
    assert!(
        upsert_payload["item"]["favoritedAtMs"]
            .as_u64()
            .unwrap_or_default()
            > 1,
        "Remote Favorite upsert should use the Runtime clock, not caller-supplied timestamps: {upsert_payload}"
    );

    let (address, server) = serve_runtime_once(runtime.clone());
    let remove_response = send_remote_favorite_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/favorites/remove",
        r#"{"rootId":"shared-root","path":"albums/old"}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        remove_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Favorite remove should be served by the Runtime: {remove_response}"
    );
    assert_eq!(
        response_json(&remove_response),
        serde_json::json!({"ok": true})
    );

    let (address, server) = serve_runtime_once(runtime);
    let final_list_response =
        send_remote_favorites_list_request(&address, Some(&session_cookie_pair));
    server.join().expect("server thread should finish");
    let final_list_payload = response_json(&final_list_response);
    let final_paths = final_list_payload["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["path"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(final_paths, vec!["albums/new"]);
    assert!(
        !list_response.contains(&shared_root_json)
            && !upsert_response.contains(&shared_root_json)
            && !final_list_response.contains(&shared_root_json),
        "Remote Favorite responses must not expose Remote Root host paths"
    );
}

#[test]
fn runtime_api_remote_faces_resolve_remote_roots_without_host_paths() {
    let fixture = Fixture::new("runtime_api_remote_faces_resolve_remote_roots_without_host_paths");
    fixture.create_dir("Shared Root/photos");
    fixture.create_dir("Other Root/photos");
    fixture.write_bytes("Shared Root/photos/ada.png", FACE_CROP_SOURCE_PNG);
    fixture.write_file("Shared Root/photos/ada-2.jpg", "second face source");
    fixture.write_file("Other Root/photos/outside.jpg", "outside face source");
    let shared_root_path = fixture.root.join("Shared Root");
    let other_root_path = fixture.root.join("Other Root");
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
    fixture.write_file(
        ".runtime-home/global/faces.v1.json",
        &serde_json::json!({
            "version": 1,
            "faces": [
                {
                    "rootPath": shared_root_path.display().to_string(),
                    "rootRelativePath": "photos/ada.png",
                    "assetId": "asset-a-1",
                    "faceId": "face-a-1",
                    "boundingBox": { "x1": 1.0, "y1": 1.0, "x2": 3.0, "y2": 3.0 },
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
                    "rootPath": shared_root_path.display().to_string(),
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
    );

    let runtime = fauplay_runtime::FauplayRuntime::with_runtime_home_path(&runtime_home_path);
    let (address, server) = serve_runtime_once(runtime.clone());
    let unauthorized_response = send_remote_faces_request(
        &address,
        None,
        "/v1/remote/faces/list-people",
        r#"{"rootId":"shared-root"}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        unauthorized_response.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "Remote People should require a Remote Access session: {unauthorized_response}"
    );

    let session_cookie_pair = login_remote_session_cookie_pair(runtime.clone());
    let (address, server) = serve_runtime_once(runtime.clone());
    let people_response = send_remote_faces_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/faces/list-people",
        r#"{"rootId":"shared-root","query":"Ada","page":1,"size":10}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        people_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote People should be served by the Runtime: {people_response}"
    );
    let people_payload = response_json(&people_response);
    assert_eq!(people_payload["ok"], true);
    assert_eq!(people_payload["scope"], "root");
    assert_eq!(people_payload["total"], 1);
    assert_eq!(people_payload["items"][0]["personId"], "person-a");
    assert_eq!(people_payload["items"][0]["name"], "Ada");
    assert_eq!(people_payload["items"][0]["faceCount"], 2);
    assert_eq!(people_payload["items"][0]["globalFaceCount"], 3);
    assert_eq!(people_payload["items"][0]["featureFaceId"], "face-a-2");
    assert_eq!(
        people_payload["items"][0]["featureAssetPath"],
        "photos/ada-2.jpg"
    );
    assert!(people_payload["items"][0].get("absolutePath").is_none());

    let (address, server) = serve_runtime_once(runtime.clone());
    let person_faces_response = send_remote_faces_request(
        &address,
        Some(&session_cookie_pair),
        "/v1/remote/faces/list-person-faces",
        r#"{"rootId":"shared-root","personId":"person-a"}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        person_faces_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Person Faces should be served by the Runtime: {person_faces_response}"
    );
    let person_faces_payload = response_json(&person_faces_response);
    assert_eq!(person_faces_payload["ok"], true);
    assert_eq!(person_faces_payload["scope"], "root");
    assert_eq!(person_faces_payload["total"], 2);
    let person_face_ids = person_faces_payload["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["faceId"].as_str())
        .collect::<Vec<_>>();
    assert!(person_face_ids.contains(&"face-a-1"));
    assert!(person_face_ids.contains(&"face-a-2"));
    assert!(
        person_faces_payload["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["assetPath"] == "photos/ada.png")
    );
    assert!(
        person_faces_payload["items"][0]
            .get("absolutePath")
            .is_none()
    );

    let (address, server) = serve_runtime_once(runtime);
    let crop_response = send_remote_face_crop_request(
        &address,
        Some(&session_cookie_pair),
        "face-a-1",
        "rootId=shared-root&size=96&padding=0.25",
    );
    server.join().expect("server thread should finish");
    let (crop_headers, crop_body) = split_binary_http_response(&crop_response);
    assert!(
        crop_headers.starts_with("HTTP/1.1 200 OK\r\n"),
        "Remote Face Crop should be served by the Runtime: {crop_headers}"
    );
    assert!(
        crop_headers.contains("Content-Type: image/jpeg"),
        "Remote Face Crop should be a JPEG response: {crop_headers}"
    );
    assert!(
        crop_headers.contains("Cache-Control: private, max-age=300"),
        "Remote Face Crop should use derivative cache policy: {crop_headers}"
    );
    assert!(
        crop_body.starts_with(&[0xFF, 0xD8]) && crop_body.ends_with(&[0xFF, 0xD9]),
        "Remote Face Crop body should be JPEG bytes"
    );
    assert!(
        !people_response.contains(&shared_root_json)
            && !person_faces_response.contains(&shared_root_json)
            && !String::from_utf8_lossy(&crop_response).contains(&shared_root_json),
        "Remote face responses must not expose Remote Root host paths"
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

fn response_body(response: &str) -> &str {
    response
        .split("\r\n\r\n")
        .nth(1)
        .expect("HTTP response should contain a body")
}

fn response_header(response: &str, header_name: &str) -> Option<String> {
    response.lines().skip(1).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case(header_name)
            .then(|| value.trim().to_owned())
    })
}

fn split_binary_http_response(response: &[u8]) -> (String, &[u8]) {
    let marker = b"\r\n\r\n";
    let split_at = response
        .windows(marker.len())
        .position(|window| window == marker)
        .expect("HTTP response should include a header/body separator");
    let headers = String::from_utf8_lossy(&response[..split_at + marker.len()]).to_string();
    let body = &response[split_at + marker.len()..];
    (headers, body)
}
