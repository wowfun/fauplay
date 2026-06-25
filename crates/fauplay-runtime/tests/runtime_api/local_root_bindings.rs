use super::support::*;

#[test]
fn runtime_api_persists_local_root_bindings() {
    let fixture = Fixture::new("runtime_api_persists_local_root_bindings");
    fixture.create_dir("Library Root");
    let bound_root_path = fixture.root.join("Library Root");

    let runtime_home_path = fixture.root.join(".runtime-home");
    let upsert_response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_local_root_binding_upsert_request(
            address,
            "root-one",
            &bound_root_path.display().to_string(),
        )
    });
    let list_response = send_runtime_home_request_once(&runtime_home_path, |address| {
        send_local_root_bindings_request(address)
    });

    assert!(
        upsert_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "upsert response should be OK: {upsert_response}"
    );
    assert!(
        list_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "list response should be OK: {list_response}"
    );
    assert!(
        list_response.contains("\"rootId\":\"root-one\""),
        "list response should include the Local Root identity: {list_response}"
    );
    assert!(
        list_response.contains(&format!("\"rootPath\":\"{}\"", json_path(&bound_root_path))),
        "list response should include the bound host path: {list_response}"
    );
}
