use fauplay_runtime::FauplayRuntime;

use super::support::*;

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
