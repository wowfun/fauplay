use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_queries_duplicate_files_inside_local_root() {
    let fixture = Fixture::new("runtime_api_queries_duplicate_files_inside_local_root");
    fixture.write_file("albums/current.jpg", "same image");
    fixture.write_file("albums/copy.jpg", "same image");
    fixture.write_file(".trash/current.jpg", "same image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_duplicate_files_request(
        &address,
        &fixture.root.display().to_string(),
        &["albums/current.jpg"],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"duplicateSetCount\":1"),
        "response should report one Duplicate Set: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/current.jpg\""),
        "response should include the seed file: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/copy.jpg\""),
        "response should include the duplicate file: {response}"
    );
    assert!(
        !response.contains(".trash/current.jpg"),
        "response should not include Root Trash candidates: {response}"
    );
}

#[test]
fn runtime_api_queries_duplicate_files_from_json_body() {
    let fixture = Fixture::new("runtime_api_queries_duplicate_files_from_json_body");
    fixture.write_file("albums/a.jpg", "same image");
    fixture.write_file("albums/b.jpg", "same image");
    fixture.write_file("albums/c.jpg", "same image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_duplicate_files_json_request(
        &address,
        &fixture.root.display().to_string(),
        &["albums/a.jpg", "albums/b.jpg"],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"seedCount\":2"),
        "response should include both JSON seed paths: {response}"
    );
    assert!(
        response.contains("\"duplicateSetCount\":1"),
        "response should report one Duplicate Set: {response}"
    );
    assert!(
        response.contains("\"seedRootRelativePaths\":[\"albums/a.jpg\",\"albums/b.jpg\"]"),
        "response should preserve seed paths in request order: {response}"
    );
}
