use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_loads_global_shortcut_config() {
    let fixture = Fixture::new("runtime_api_loads_global_shortcut_config");
    fixture.write_file(
        "global/shortcuts.json",
        r#"{"version":1,"keybinds":{"preview_next":["n"]}}"#,
    );

    let runtime_home_path = fixture.root.clone();
    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(runtime_home_path));

    let response = send_global_shortcut_config_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"loaded\":true"),
        "response should report loaded config: {response}"
    );
    assert!(
        response.contains("\"config\":{\"version\":1,\"keybinds\":{\"preview_next\":[\"n\"]}}"),
        "response should include the shortcut config object: {response}"
    );
}

#[test]
fn runtime_api_rejects_invalid_global_shortcut_config() {
    let fixture = Fixture::new("runtime_api_rejects_invalid_global_shortcut_config");
    fixture.write_file("global/shortcuts.json", r#"{"version":1,"keybinds":"#);

    let runtime_home_path = fixture.root;
    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(runtime_home_path));

    let response = send_global_shortcut_config_request(&address);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 500 Internal Server Error\r\n"),
        "response should reject invalid config: {response}"
    );
    assert!(
        response.contains("invalid global shortcut config"),
        "response should explain the invalid config: {response}"
    );
}
