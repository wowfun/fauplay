use std::net::TcpListener;
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

use super::support::*;

#[test]
fn runtime_api_moves_root_relative_path_within_local_root() {
    let fixture = Fixture::new("runtime_api_moves_root_relative_path_within_local_root");
    fixture.write_file("albums/photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_move_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "albums/photo.jpg",
        "albums/renamed.jpg",
        false,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"sourceRootRelativePath\":\"albums/photo.jpg\""),
        "response should include the source Root-relative Path: {response}"
    );
    assert!(
        response.contains("\"targetRootRelativePath\":\"albums/renamed.jpg\""),
        "response should include the target Root-relative Path: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "response should report a successful Root Move: {response}"
    );
    fixture.assert_missing("albums/photo.jpg");
    fixture.assert_file("albums/renamed.jpg", "image");
}

#[test]
fn runtime_api_plans_root_move_without_mutating_when_dry_run() {
    let fixture = Fixture::new("runtime_api_plans_root_move_without_mutating_when_dry_run");
    fixture.write_file("albums/photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_move_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "albums/photo.jpg",
        "albums/renamed.jpg",
        true,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"dryRun\":true"),
        "response should report a dry-run Root Move: {response}"
    );
    assert!(
        response.contains("\"ok\":true"),
        "response should report a planned Root Move: {response}"
    );
    fixture.assert_file("albums/photo.jpg", "image");
    fixture.assert_missing("albums/renamed.jpg");
}

#[test]
fn runtime_api_plans_root_move_batch_from_json_body() {
    let fixture = Fixture::new("runtime_api_plans_root_move_batch_from_json_body");
    fixture.write_file("albums/a.jpg", "a");
    fixture.write_file("albums/b.jpg", "b");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_move_batch_json_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        &["albums/a.jpg", "albums/b.jpg"],
        true,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"dryRun\":true"),
        "response should report a dry-run Root Move Batch: {response}"
    );
    assert!(
        response.contains("\"moved\":2"),
        "response should report planned Root Moves: {response}"
    );
    assert!(
        response.contains("\"nextRootRelativePath\":\"albums/albums-03-a.jpg\""),
        "response should include the first planned target: {response}"
    );
    assert!(
        response.contains("\"nextRootRelativePath\":\"albums/albums-04-b.jpg\""),
        "response should include the second planned target: {response}"
    );
    fixture.assert_file("albums/a.jpg", "a");
    fixture.assert_file("albums/b.jpg", "b");
    fixture.assert_missing("albums/albums-03-a.jpg");
}

#[test]
fn runtime_api_reports_root_move_target_conflicts_without_overwriting() {
    let fixture =
        Fixture::new("runtime_api_reports_root_move_target_conflicts_without_overwriting");
    fixture.write_file("albums/photo.jpg", "new image");
    fixture.write_file("albums/renamed.jpg", "existing image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_move_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "albums/photo.jpg",
        "albums/renamed.jpg",
        false,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"ok\":false"),
        "response should report a failed Root Move: {response}"
    );
    assert!(
        response.contains("\"reason\":\"target_exists\""),
        "response should report the target conflict reason: {response}"
    );
    fixture.assert_file("albums/photo.jpg", "new image");
    fixture.assert_file("albums/renamed.jpg", "existing image");
}

#[test]
fn runtime_api_moves_root_relative_path_to_root_trash() {
    let fixture = Fixture::new("runtime_api_moves_root_relative_path_to_root_trash");
    fixture.write_file("photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_trash_request(
        &address.to_string(),
        "move",
        &fixture.root.display().to_string(),
        "photo.jpg",
        false,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"completed\":1"),
        "response should report a completed Root Trash move: {response}"
    );
    assert!(
        response.contains("\"nextRootRelativePath\":\".trash/photo.jpg\""),
        "response should include the Root Trash target path: {response}"
    );
    fixture.assert_missing("photo.jpg");
    fixture.assert_file(".trash/photo.jpg", "image");
}

#[test]
fn runtime_api_moves_multiple_root_relative_paths_to_root_trash() {
    let fixture = Fixture::new("runtime_api_moves_multiple_root_relative_paths_to_root_trash");
    fixture.write_file("photo-a.jpg", "image a");
    fixture.write_file("photo-b.jpg", "image b");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_trash_request_with_paths(
        &address.to_string(),
        "move",
        &fixture.root.display().to_string(),
        &["photo-a.jpg", "photo-b.jpg"],
        false,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"total\":2"),
        "response should include both Root Trash items: {response}"
    );
    assert!(
        response.contains("\"completed\":2"),
        "response should complete both Root Trash moves: {response}"
    );
    fixture.assert_missing("photo-a.jpg");
    fixture.assert_missing("photo-b.jpg");
    fixture.assert_file(".trash/photo-a.jpg", "image a");
    fixture.assert_file(".trash/photo-b.jpg", "image b");
}

#[test]
fn runtime_api_restores_root_trash_item() {
    let fixture = Fixture::new("runtime_api_restores_root_trash_item");
    fixture.write_file(".trash/photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_root_trash_request(
        &address.to_string(),
        "restore",
        &fixture.root.display().to_string(),
        ".trash/photo.jpg",
        false,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"completed\":1"),
        "response should report a completed Root Trash restore: {response}"
    );
    assert!(
        response.contains("\"nextRootRelativePath\":\"photo.jpg\""),
        "response should include the restored Root-relative Path: {response}"
    );
    fixture.assert_missing(".trash/photo.jpg");
    fixture.assert_file("photo.jpg", "image");
}

#[test]
fn runtime_api_lists_root_trash_entries() {
    let fixture = Fixture::new("runtime_api_lists_root_trash_entries");
    fixture.write_file(".trash/photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response =
        send_root_trash_list_request(&address.to_string(), &fixture.root.display().to_string());
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\".trash/photo.jpg\""),
        "response should include the Root Trash Entry path: {response}"
    );
    assert!(
        response.contains("\"originalRootRelativePath\":\"photo.jpg\""),
        "response should include the restore target Root-relative Path: {response}"
    );
    assert!(
        response.contains("\"deletedAtMs\":"),
        "response should include deletion timestamp metadata: {response}"
    );
}
