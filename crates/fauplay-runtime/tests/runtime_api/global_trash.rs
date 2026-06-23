use std::net::TcpListener;
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

use super::support::*;

#[test]
fn runtime_api_lists_global_trash_entries() {
    let fixture = Fixture::new("runtime_api_lists_global_trash_entries");
    fixture.write_file("global/recycle/files/item-1.jpg", "image");
    let stored_path = fixture.root.join("global/recycle/files/item-1.jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/photos/original.jpg","name":"original.jpg","size":123,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root;
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_request(&address.to_string());
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"sourceType\":\"global_recycle\""),
        "response should mark entries as legacy-compatible global recycle items: {response}"
    );
    assert!(
        response.contains("\"recycleId\":\"item-1\""),
        "response should include the recycle id: {response}"
    );
    assert!(
        response.contains("\"displayPath\":\"/photos/original.jpg\""),
        "response should include the original display path: {response}"
    );
}

#[test]
fn runtime_api_returns_global_trash_file_content_by_recycle_id() {
    let fixture = Fixture::new("runtime_api_returns_global_trash_file_content_by_recycle_id");
    fixture.write_file("global/recycle/files/item-1.jpg", "image-bytes");
    let stored_path = fixture.root.join("global/recycle/files/item-1.jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/photos/original.jpg","name":"original.jpg","size":11,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root;
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_file_content_request(&address.to_string(), "item-1");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "response should be OK: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Content-Type: image/jpeg".len())
            .any(|window| window == b"Content-Type: image/jpeg"),
        "response should include image/jpeg content type: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response.ends_with(b"image-bytes"),
        "response body should contain the Global Trash Entry bytes: {}",
        String::from_utf8_lossy(&response)
    );
}

#[test]
fn runtime_api_ranges_global_trash_file_content_by_recycle_id() {
    let fixture = Fixture::new("runtime_api_ranges_global_trash_file_content_by_recycle_id");
    fixture.write_file("global/recycle/files/item-1.mp4", "0123456789");
    let stored_path = fixture.root.join("global/recycle/files/item-1.mp4");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/videos/original.mp4","name":"original.mp4","size":10,"mimeType":"video/mp4","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root;
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_file_content_request_with_range(
        &address.to_string(),
        "item-1",
        "bytes=2-5",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with(b"HTTP/1.1 206 Partial Content\r\n"),
        "response should be partial content: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Content-Range: bytes 2-5/10".len())
            .any(|window| window == b"Content-Range: bytes 2-5/10"),
        "response should include the requested content range: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response.ends_with(b"2345"),
        "response body should contain the requested byte range: {}",
        String::from_utf8_lossy(&response)
    );
}

#[test]
fn runtime_api_rejects_global_trash_file_content_outside_runtime_storage() {
    let fixture =
        Fixture::new("runtime_api_rejects_global_trash_file_content_outside_runtime_storage");
    fixture.write_file("outside.jpg", "outside-bytes");
    let outside_path = fixture.root.join("outside.jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/photos/original.jpg","name":"original.jpg","size":13,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&outside_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root;
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_file_content_request(&address.to_string(), "item-1");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with(b"HTTP/1.1 404 Not Found\r\n"),
        "response should reject content outside Global Trash storage: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        !response.ends_with(b"outside-bytes"),
        "response must not include bytes outside Global Trash storage: {}",
        String::from_utf8_lossy(&response)
    );
}

#[test]
fn runtime_api_returns_global_trash_text_preview_by_recycle_id() {
    let fixture = Fixture::new("runtime_api_returns_global_trash_text_preview_by_recycle_id");
    fixture.write_file("global/recycle/files/item-1.txt", "hello from Global Trash");
    let stored_path = fixture.root.join("global/recycle/files/item-1.txt");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/notes/original.txt","name":"original.txt","size":23,"mimeType":"text/plain","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root;
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_text_preview_request(&address.to_string(), "item-1", 1024);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"status\":\"ready\""),
        "response should report ready text preview: {response}"
    );
    assert!(
        response.contains("\"content\":\"hello from Global Trash\""),
        "response should include the Global Trash Entry text: {response}"
    );
}

#[test]
fn runtime_api_returns_global_trash_file_metadata_by_recycle_id() {
    let fixture = Fixture::new("runtime_api_returns_global_trash_file_metadata_by_recycle_id");
    fixture.write_file("global/recycle/files/item-1.md", "metadata bytes");
    let stored_path = fixture.root.join("global/recycle/files/item-1.md");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/notes/original.md","name":"original.md","size":1,"mimeType":"text/markdown","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root;
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_file_metadata_request(&address.to_string(), "item-1");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"recycleId\":\"item-1\""),
        "response should include the recycle id: {response}"
    );
    assert!(
        response.contains("\"size\":14"),
        "response should report the current stored file size: {response}"
    );
    assert!(
        response.contains("\"lastModifiedMs\":"),
        "response should include the current stored file modification timestamp: {response}"
    );
}

#[test]
fn runtime_api_moves_file_to_global_trash() {
    let fixture = Fixture::new("runtime_api_moves_file_to_global_trash");
    fixture.write_file("source/original.jpg", "image");
    let source_path = fixture.root.join("source/original.jpg");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root.clone();
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_move_request(&address.to_string(), &[&source_path], false);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"moved\":1"),
        "response should report a moved Global Trash Entry: {response}"
    );
    assert!(
        response.contains("\"sourceType\":\"global_recycle\""),
        "response should mark the moved item as Global Trash: {response}"
    );
    assert!(
        response.contains("\"recycleId\":\""),
        "response should include a recycle id: {response}"
    );
    fixture.assert_missing("source/original.jpg");
    assert!(
        fixture.root.join("global/recycle/items.json").is_file(),
        "Global Trash metadata should be written"
    );
}

#[test]
fn runtime_api_restores_global_trash_entry() {
    let fixture = Fixture::new("runtime_api_restores_global_trash_entry");
    fixture.write_file("global/recycle/files/item-1.jpg", "image");
    let stored_path = fixture.root.join("global/recycle/files/item-1.jpg");
    let original_path = fixture.root.join("restored/original.jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"{}","name":"original.jpg","size":5,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
            json_path(&original_path),
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let runtime_home_path = fixture.root.clone();
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let response = send_global_trash_restore_request(&address.to_string(), &["item-1"], false);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"restored\":1"),
        "response should report a restored Global Trash Entry: {response}"
    );
    assert!(
        response.contains(&format!(
            "\"nextAbsolutePath\":\"{}\"",
            json_path(&original_path)
        )),
        "response should include the restored absolute path: {response}"
    );
    fixture.assert_missing("global/recycle/files/item-1.jpg");
    fixture.assert_file("restored/original.jpg", "image");
    fixture.assert_file("global/recycle/items.json", "[]");
}
