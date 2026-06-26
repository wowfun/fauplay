use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_creates_remembered_device_credentials() {
    let fixture = Fixture::new("runtime_api_creates_remembered_device_credentials");
    let body = r#"{"label":"  Desk   Browser  ","userAgent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"}"#;

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_create_remembered_device_request(&address, body);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "create response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "create response should report success: {response}"
    );
    assert!(
        response.contains("\"label\":\"Desk Browser\""),
        "create response should normalize the user label: {response}"
    );
    assert!(
        response.contains("\"autoLabel\":\"Chrome · Linux\"")
            && response.contains("\"userAgentSummary\":\"Linux · Chrome\""),
        "create response should derive display labels from the user agent: {response}"
    );
    assert!(
        response.contains("\"cookieValue\":\"") && response.contains("."),
        "create response should include a cookie credential: {response}"
    );
    assert!(
        !response.contains("tokenHash"),
        "create response should not expose token hashes: {response}"
    );

    let created = response_body_json(&response);
    let id = created
        .get("device")
        .and_then(|device| device.get("id"))
        .and_then(serde_json::Value::as_str)
        .expect("create response should include device id");

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_remembered_devices_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.contains(&format!("\"id\":\"{id}\"")),
        "list response should include the created Remembered Device: {response}"
    );
    assert!(
        !response.contains("cookieValue") && !response.contains("tokenHash"),
        "list response should not expose credentials: {response}"
    );
}

#[test]
fn runtime_api_rotates_and_revokes_remembered_device_credentials() {
    let fixture = Fixture::new("runtime_api_rotates_and_revokes_remembered_device_credentials");

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_create_remembered_device_request(
        &address,
        r#"{"label":"Desk","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"}"#,
    );
    server.join().expect("server thread should finish");
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "create response should be OK: {response}"
    );
    let created = response_body_json(&response);
    let id = created
        .get("device")
        .and_then(|device| device.get("id"))
        .and_then(serde_json::Value::as_str)
        .expect("create response should include device id")
        .to_owned();
    let cookie_value = created
        .get("device")
        .and_then(|device| device.get("cookieValue"))
        .and_then(serde_json::Value::as_str)
        .expect("create response should include cookie value")
        .to_owned();

    let rotate_body = format!(r#"{{"cookieValue":"{cookie_value}"}}"#);
    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_rotate_remembered_device_request(&address, &rotate_body);
    server.join().expect("server thread should finish");
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "rotate response should be OK: {response}"
    );
    assert!(
        response.contains(&format!("\"id\":\"{id}\"")),
        "rotate response should keep the same Remembered Device id: {response}"
    );
    let rotated = response_body_json(&response);
    let rotated_cookie_value = rotated
        .get("device")
        .and_then(|device| device.get("cookieValue"))
        .and_then(serde_json::Value::as_str)
        .expect("rotate response should include cookie value");
    assert_ne!(
        rotated_cookie_value, cookie_value,
        "rotate response should replace the credential secret"
    );
    assert!(
        !response.contains("tokenHash"),
        "rotate response should not expose token hashes: {response}"
    );

    let stale_rotate_body = format!(r#"{{"cookieValue":"{cookie_value}"}}"#);
    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_rotate_remembered_device_request(&address, &stale_rotate_body);
    server.join().expect("server thread should finish");
    assert!(
        response.starts_with("HTTP/1.1 404 Not Found\r\n"),
        "the previous credential should no longer rotate: {response}"
    );

    let revoke_body = format!(r#"{{"cookieValue":"{rotated_cookie_value}"}}"#);
    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_revoke_remembered_device_credential_request(&address, &revoke_body);
    server.join().expect("server thread should finish");
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "revoke response should be OK: {response}"
    );
    assert!(
        response.contains(&format!("\"revokedDeviceIds\":[\"{id}\"]")),
        "revoke response should report the revoked Remembered Device id: {response}"
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_remembered_devices_request(&address);
    server.join().expect("server thread should finish");
    assert!(
        response.contains("\"items\":[]"),
        "list response should be empty after credential revoke: {response}"
    );
}

#[test]
fn runtime_api_lists_remembered_devices_from_runtime_home() {
    let fixture = Fixture::new("runtime_api_lists_remembered_devices_from_runtime_home");
    fixture.write_file(
        "global/remote-remembered-devices.v1.json",
        r#"{
  "version": 1,
  "devices": [
    {
      "id": "device-1",
      "tokenHash": "secret-hash",
      "label": "Desk",
      "autoLabel": "Chrome on Linux",
      "userAgentSummary": "Linux Chrome",
      "createdAtMs": 100,
      "lastUsedAtMs": 300,
      "expiresAtMs": 4102444800000
    },
    {
      "id": "legacy-device",
      "tokenHash": "legacy-secret-hash",
      "createdAtMs": 50,
      "lastUsedAtMs": 200,
      "expiresAtMs": 4102444800000
    }
  ]
}"#,
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));

    let response = send_remembered_devices_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"id\":\"device-1\""),
        "response should include device id: {response}"
    );
    assert!(
        response.contains("\"label\":\"Desk\""),
        "response should include user label: {response}"
    );
    assert!(
        response.contains("\"autoLabel\":\"Chrome on Linux\""),
        "response should include auto label: {response}"
    );
    assert!(
        response
            .contains("\"autoLabel\":\"\u{65e7}\u{7248}\u{5df2}\u{8bb0}\u{4f4f}\u{8bbe}\u{5907}\""),
        "response should include the legacy fallback auto label: {response}"
    );
    assert!(
        !response.contains("tokenHash"),
        "response should not expose token hashes: {response}"
    );
}

fn response_body_json(response: &str) -> serde_json::Value {
    let body = response
        .split("\r\n\r\n")
        .nth(1)
        .expect("response should contain a body");
    serde_json::from_str(body).expect("response body should be JSON")
}

#[test]
fn runtime_api_renames_remembered_device_in_runtime_home() {
    let fixture = Fixture::new("runtime_api_renames_remembered_device_in_runtime_home");
    fixture.write_file(
        "global/remote-remembered-devices.v1.json",
        r#"{
  "version": 1,
  "devices": [
    {
      "id": "device-1",
      "tokenHash": "secret-hash",
      "label": "Old label",
      "autoLabel": "Chrome on Linux",
      "userAgentSummary": "Linux Chrome",
      "createdAtMs": 100,
      "lastUsedAtMs": 300,
      "expiresAtMs": 4102444800000
    }
  ]
}"#,
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_rename_remembered_device_request(&address, "device-1", " Desk ");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "rename response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "rename response should report success: {response}"
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_remembered_devices_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.contains("\"label\":\"Desk\""),
        "list response should include the renamed label: {response}"
    );
    assert!(
        !response.contains("Old label"),
        "list response should not include the previous label: {response}"
    );
}

#[test]
fn runtime_api_revokes_remembered_device_from_runtime_home() {
    let fixture = Fixture::new("runtime_api_revokes_remembered_device_from_runtime_home");
    fixture.write_file(
        "global/remote-remembered-devices.v1.json",
        r#"{
  "version": 1,
  "devices": [
    {
      "id": "device-1",
      "tokenHash": "secret-hash-1",
      "label": "Desk",
      "autoLabel": "Chrome on Linux",
      "userAgentSummary": "Linux Chrome",
      "createdAtMs": 100,
      "lastUsedAtMs": 300,
      "expiresAtMs": 4102444800000
    },
    {
      "id": "device-2",
      "tokenHash": "secret-hash-2",
      "label": "Tablet",
      "autoLabel": "Safari on iPad",
      "userAgentSummary": "iPad Safari",
      "createdAtMs": 200,
      "lastUsedAtMs": 400,
      "expiresAtMs": 4102444800000
    }
  ]
}"#,
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_revoke_remembered_device_request(&address, "device-1");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "revoke response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "revoke response should report success: {response}"
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_remembered_devices_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        !response.contains("\"id\":\"device-1\""),
        "list response should not include revoked device: {response}"
    );
    assert!(
        response.contains("\"id\":\"device-2\""),
        "list response should keep other devices: {response}"
    );
}

#[test]
fn runtime_api_revokes_all_remembered_devices_from_runtime_home() {
    let fixture = Fixture::new("runtime_api_revokes_all_remembered_devices_from_runtime_home");
    fixture.write_file(
        "global/remote-remembered-devices.v1.json",
        r#"{
  "version": 1,
  "devices": [
    {
      "id": "device-1",
      "tokenHash": "secret-hash-1",
      "label": "Desk",
      "autoLabel": "Chrome on Linux",
      "userAgentSummary": "Linux Chrome",
      "createdAtMs": 100,
      "lastUsedAtMs": 300,
      "expiresAtMs": 4102444800000
    },
    {
      "id": "device-2",
      "tokenHash": "secret-hash-2",
      "label": "Tablet",
      "autoLabel": "Safari on iPad",
      "userAgentSummary": "iPad Safari",
      "createdAtMs": 200,
      "lastUsedAtMs": 400,
      "expiresAtMs": 4102444800000
    }
  ]
}"#,
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_revoke_all_remembered_devices_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "revoke-all response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "revoke-all response should report success: {response}"
    );

    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(&fixture.root));
    let response = send_remembered_devices_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.contains("\"items\":[]"),
        "list response should be empty after revoke-all: {response}"
    );
}
