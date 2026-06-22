use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{thread, time::Duration};

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

#[test]
fn runtime_api_lists_a_local_root_directory() {
    let fixture = Fixture::new("runtime_api_lists_a_local_root_directory");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/local-directory?rootPath={}&rootRelativePath= HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        fixture.root.display()
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums\""),
        "response should include the directory entry: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "response should include the file entry: {response}"
    );
}

#[test]
fn runtime_api_reports_health() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "health response should be OK: {response}"
    );
    assert!(
        response.contains("\"status\":\"ok\""),
        "health response should report ok status: {response}"
    );
    assert!(
        response.contains("\"runtime\":\"fauplay-runtime\""),
        "health response should identify the runtime: {response}"
    );
}

#[test]
fn runtime_api_loads_global_shortcut_config() {
    let fixture = Fixture::new("runtime_api_loads_global_shortcut_config");
    fixture.write_file(
        "global/shortcuts.json",
        r#"{"version":1,"keybinds":{"preview_next":["n"]}}"#,
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

    let response = send_global_shortcut_config_request(&address.to_string());
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

    let response = send_global_shortcut_config_request(&address.to_string());
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

#[test]
fn runtime_api_decodes_query_values_before_listing() {
    let fixture = Fixture::new("runtime api decodes query values");
    fixture.create_dir("albums/2024 photos");
    fixture.write_file("albums/2024 photos/photo one.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_root_relative_path(
        &address.to_string(),
        &percent_encode(&fixture.root.to_string_lossy()),
        &percent_encode("albums/2024 photos"),
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024 photos/photo one.jpg\""),
        "response should include the decoded child entry: {response}"
    );
}

#[test]
fn runtime_api_decodes_url_search_params_space_encoding() {
    let fixture = Fixture::new("runtime api decodes url search params space encoding");
    fixture.create_dir("albums/2024 photos");
    fixture.write_file("albums/2024 photos/photo one.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_root_relative_path(
        &address.to_string(),
        &percent_encode(&fixture.root.to_string_lossy()),
        "albums/2024+photos",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024 photos/photo one.jpg\""),
        "response should decode + as a query-space encoding: {response}"
    );
}

#[test]
fn runtime_api_exposes_file_metadata() {
    let fixture = Fixture::new("runtime_api_exposes_file_metadata");
    fixture.write_file("photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request(&address.to_string(), &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"size\":5"),
        "response should include file size metadata: {response}"
    );
    assert!(
        response.contains("\"lastModifiedMs\":"),
        "response should include file modification metadata: {response}"
    );
}

#[test]
fn runtime_api_exposes_directory_emptiness_metadata() {
    let fixture = Fixture::new("runtime_api_exposes_directory_emptiness_metadata");
    fixture.create_dir("empty-album");
    fixture.create_dir("filled-album");
    fixture.write_file("filled-album/photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request(&address.to_string(), &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains(
            "\"rootRelativePath\":\"empty-album\",\"kind\":\"directory\",\"isEmpty\":true"
        ),
        "response should include empty directory metadata: {response}"
    );
    assert!(
        response.contains(
            "\"rootRelativePath\":\"filled-album\",\"kind\":\"directory\",\"isEmpty\":false"
        ),
        "response should include non-empty directory metadata: {response}"
    );
}

#[test]
fn runtime_api_exposes_directory_entry_count_metadata() {
    let fixture = Fixture::new("runtime_api_exposes_directory_entry_count_metadata");
    fixture.create_dir("album/.trash");
    fixture.create_dir("album/nested");
    fixture.write_file("album/photo.jpg", "image");
    fixture.write_file("album/.trash/deleted.jpg", "deleted");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request(&address.to_string(), &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"album\",\"kind\":\"directory\",\"isEmpty\":false,\"entryCount\":2"),
        "response should include Directory Entry Count metadata: {response}"
    );
}

#[test]
fn runtime_api_lists_flattened_descendant_files() {
    let fixture = Fixture::new("runtime_api_lists_flattened_descendant_files");
    fixture.write_file("cover.jpg", "cover");
    fixture.create_dir("albums/2024");
    fixture.write_file("albums/2024/photo.jpg", "image");
    fixture.create_dir("albums/empty");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_options(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "albums",
        &[("flattened", "true")],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024/photo.jpg\""),
        "response should include nested file entry: {response}"
    );
    assert!(
        !response.contains("\"rootRelativePath\":\"albums/2024\",\"kind\":\"directory\""),
        "Flattened Listing should not include directory entries: {response}"
    );
    assert!(
        !response.contains("\"rootRelativePath\":\"cover.jpg\""),
        "Flattened Listing should stay under the requested Root-relative Path: {response}"
    );
}

#[test]
fn runtime_api_marks_limited_listings_truncated() {
    let fixture = Fixture::new("runtime_api_marks_limited_listings_truncated");
    fixture.write_file("a.jpg", "image");
    fixture.write_file("b.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_options(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "",
        &[("limit", "1")],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"isTruncated\":true"),
        "response should report a Truncated Listing: {response}"
    );
    assert_eq!(
        response.matches("\"kind\":\"file\"").count(),
        1,
        "response should only include the requested number of entries: {response}"
    );
}

#[test]
fn runtime_api_returns_next_offset_for_listing_pages() {
    let fixture = Fixture::new("runtime_api_returns_next_offset_for_listing_pages");
    fixture.write_file("a.jpg", "image");
    fixture.write_file("b.jpg", "image");
    fixture.write_file("c.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_options(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "",
        &[("limit", "1"), ("offset", "1")],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"b.jpg\""),
        "response should return the requested Listing Page: {response}"
    );
    assert!(
        response.contains("\"nextOffset\":2"),
        "response should include the next Listing Page offset: {response}"
    );
}

#[test]
fn runtime_api_applies_listing_query_parameters() {
    let fixture = Fixture::new("runtime_api_applies_listing_query_parameters");
    fixture.write_file("a-small.jpg", "1");
    fixture.write_file("z-large.jpg", "12345");
    fixture.write_file("notes.txt", "notes");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_options(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "",
        &[
            ("nameContains", "jpg"),
            ("entryFilter", "image"),
            ("sortBy", "size"),
            ("sortOrder", "desc"),
            ("limit", "1"),
        ],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"z-large.jpg\""),
        "response should return the queried first Listing Page: {response}"
    );
    assert!(
        !response.contains("\"rootRelativePath\":\"notes.txt\""),
        "response should omit non-matching entries: {response}"
    );
    assert!(
        response.contains("\"nextOffset\":1"),
        "response should page the queried Listing: {response}"
    );
}

#[test]
fn runtime_api_returns_text_preview() {
    let fixture = Fixture::new("runtime_api_returns_text_preview");
    fixture.write_file("notes.txt", "hello runtime");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_text_preview_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "notes.txt",
        1024,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"status\":\"ready\""),
        "response should report ready status: {response}"
    );
    assert!(
        response.contains("\"content\":\"hello runtime\""),
        "response should include preview content: {response}"
    );
    assert!(
        response.contains("\"fileSizeBytes\":13"),
        "response should include file size: {response}"
    );
    assert!(
        response.contains("\"sizeLimitBytes\":1024"),
        "response should include size limit: {response}"
    );
}

#[test]
fn runtime_api_reports_text_preview_too_large() {
    let fixture = Fixture::new("runtime_api_reports_text_preview_too_large");
    fixture.write_file("notes.txt", "hello runtime");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_text_preview_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "notes.txt",
        4,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"status\":\"too_large\""),
        "response should report too large status: {response}"
    );
    assert!(
        response.contains("\"content\":null"),
        "response should not include content: {response}"
    );
    assert!(
        response.contains("\"fileSizeBytes\":13"),
        "response should include file size: {response}"
    );
    assert!(
        response.contains("\"sizeLimitBytes\":4"),
        "response should include caller size limit: {response}"
    );
}

#[test]
fn runtime_api_reports_binary_text_preview() {
    let fixture = Fixture::new("runtime_api_reports_binary_text_preview");
    fixture.write_bytes("blob.txt", &[0, 159, 146, 150]);

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_text_preview_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "blob.txt",
        1024,
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"status\":\"binary\""),
        "response should report binary status: {response}"
    );
    assert!(
        response.contains("\"content\":null"),
        "response should not include content: {response}"
    );
    assert!(
        response.contains("\"fileSizeBytes\":4"),
        "response should include file size: {response}"
    );
    assert!(
        response.contains("\"sizeLimitBytes\":1024"),
        "response should include caller size limit: {response}"
    );
}

#[test]
fn runtime_api_returns_file_content() {
    let fixture = Fixture::new("runtime_api_returns_file_content");
    fixture.write_file("diagram.svg", "<svg>runtime</svg>");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_file_content_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "diagram.svg",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "response should be OK: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Content-Type: image/svg+xml\r\n".len())
            .any(|window| window == b"Content-Type: image/svg+xml\r\n"),
        "response should include SVG content type: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Access-Control-Allow-Origin: *\r\n".len())
            .any(|window| window == b"Access-Control-Allow-Origin: *\r\n"),
        "response should include CORS headers: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response.ends_with(b"<svg>runtime</svg>"),
        "response body should include file content: {}",
        String::from_utf8_lossy(&response)
    );
}

#[test]
fn runtime_api_returns_file_content_byte_range() {
    let fixture = Fixture::new("runtime_api_returns_file_content_byte_range");
    fixture.write_file("clip.mp4", "0123456789");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_file_content_request_with_range(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "clip.mp4",
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
            .windows(b"Content-Type: video/mp4\r\n".len())
            .any(|window| window == b"Content-Type: video/mp4\r\n"),
        "response should include MP4 content type: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Accept-Ranges: bytes\r\n".len())
            .any(|window| window == b"Accept-Ranges: bytes\r\n"),
        "response should advertise byte range support: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Content-Range: bytes 2-5/10\r\n".len())
            .any(|window| window == b"Content-Range: bytes 2-5/10\r\n"),
        "response should include the served byte range: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response
            .windows(b"Content-Length: 4\r\n".len())
            .any(|window| window == b"Content-Length: 4\r\n"),
        "response should include range body length: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response.ends_with(b"2345"),
        "response body should include requested bytes: {}",
        String::from_utf8_lossy(&response)
    );
}

#[test]
fn runtime_api_returns_file_metadata() {
    let fixture = Fixture::new("runtime_api_returns_file_metadata");
    fixture.write_file("albums/photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_file_metadata_request(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "albums/photo.jpg",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/photo.jpg\""),
        "response should include the Root-relative Path: {response}"
    );
    assert!(
        response.contains("\"size\":5"),
        "response should include file size metadata: {response}"
    );
    assert!(
        response.contains("\"lastModifiedMs\":"),
        "response should include file modification metadata: {response}"
    );
}

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

#[test]
fn runtime_api_allows_browser_preflight_requests() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "OPTIONS /v1/local-directory HTTP/1.1\r\nOrigin: http://localhost:5173\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: content-type\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 204 No Content\r\n"),
        "preflight should succeed: {response}"
    );
    assert!(
        response.contains("Access-Control-Allow-Origin: *\r\n"),
        "preflight should allow browser origins: {response}"
    );
    assert!(
        response.contains("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"),
        "preflight should allow Runtime API methods: {response}"
    );
}

#[test]
fn runtime_api_rejects_root_relative_path_escape() {
    let fixture = Fixture::new("runtime_api_rejects_root_relative_path_escape");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_root_relative_path(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "..",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
        "response should reject invalid Root-relative Path: {response}"
    );
    assert!(
        response.contains("Root-relative Path"),
        "response should name the invalid domain term: {response}"
    );
}

#[test]
fn binary_serves_one_runtime_api_request() {
    let fixture = Fixture::new("binary_serves_one_runtime_api_request");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay-runtime"))
        .arg("serve-once")
        .arg("127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()
        .expect("runtime binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("runtime binary should print listen address");
    let address = line
        .trim()
        .strip_prefix("listening\t")
        .expect("listen line should include address")
        .to_owned();

    let response = send_list_request(&address, &fixture.root);
    let status = child.wait().expect("runtime binary should exit");

    assert!(
        status.success(),
        "runtime binary should exit after one request"
    );
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "response should include the file entry: {response}"
    );
}

#[test]
fn binary_runtime_api_server_handles_multiple_requests() {
    let fixture = Fixture::new("binary_runtime_api_server_handles_multiple_requests");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay-runtime"))
        .arg("serve")
        .arg("127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()
        .expect("runtime binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let address = read_listen_address(&mut stdout);

    let first_response = send_list_request(&address, &fixture.root);
    let second_response = send_list_request(&address, &fixture.root);

    child.kill().expect("runtime server should stop");
    let _ = child.wait();

    assert!(
        first_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "first response should be OK: {first_response}"
    );
    assert!(
        second_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "second response should be OK: {second_response}"
    );
    assert!(
        second_response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "second response should include the file entry: {second_response}"
    );
}

fn send_list_request(address: &str, root_path: &Path) -> String {
    send_list_request_with_root_relative_path(address, &root_path.display().to_string(), "")
}

fn send_list_request_with_root_relative_path(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> String {
    send_list_request_with_options(address, root_path, root_relative_path, &[])
}

fn send_list_request_with_options(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    options: &[(&str, &str)],
) -> String {
    let mut last_error = None;
    for _ in 0..20 {
        match TcpStream::connect(address) {
            Ok(mut stream) => {
                let option_query = options
                    .iter()
                    .map(|(key, value)| format!("{key}={value}"))
                    .collect::<Vec<_>>()
                    .join("&");
                let option_query = if option_query.is_empty() {
                    String::new()
                } else {
                    format!("&{option_query}")
                };
                write!(
                    stream,
                    "GET /v1/local-directory?rootPath={root_path}&rootRelativePath={root_relative_path}{option_query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
                )
                .expect("request should be written");

                let mut response = String::new();
                stream
                    .read_to_string(&mut response)
                    .expect("response should be readable");
                return response;
            }
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(25));
            }
        }
    }

    panic!("client should connect to Runtime API: {last_error:?}");
}

fn send_text_preview_request(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    size_limit_bytes: u64,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/text-preview?rootPath={root_path}&rootRelativePath={root_relative_path}&sizeLimitBytes={size_limit_bytes} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_file_content_request(address: &str, root_path: &str, root_relative_path: &str) -> Vec<u8> {
    send_file_content_request_with_headers(address, root_path, root_relative_path, "")
}

fn send_file_content_request_with_range(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    range: &str,
) -> Vec<u8> {
    send_file_content_request_with_headers(
        address,
        root_path,
        root_relative_path,
        &format!("Range: {range}\r\n"),
    )
}

fn send_file_content_request_with_headers(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    headers: &str,
) -> Vec<u8> {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/file-content?rootPath={root_path}&rootRelativePath={root_relative_path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{headers}Connection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("response should be readable");
    response
}

fn send_file_metadata_request(address: &str, root_path: &str, root_relative_path: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/file-metadata?rootPath={root_path}&rootRelativePath={root_relative_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_root_move_request(
    address: &str,
    root_path: &str,
    source_root_relative_path: &str,
    target_root_relative_path: &str,
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/root-move?rootPath={root_path}&sourceRootRelativePath={source_root_relative_path}&targetRootRelativePath={target_root_relative_path}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_root_trash_request(
    address: &str,
    operation: &str,
    root_path: &str,
    root_relative_path: &str,
    dry_run: bool,
) -> String {
    send_root_trash_request_with_paths(
        address,
        operation,
        root_path,
        &[root_relative_path],
        dry_run,
    )
}

fn send_root_trash_request_with_paths(
    address: &str,
    operation: &str,
    root_path: &str,
    root_relative_paths: &[&str],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let root_relative_path_query = root_relative_paths
        .iter()
        .map(|path| format!("rootRelativePath={path}"))
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/root-trash/{operation}?rootPath={root_path}&{root_relative_path_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_root_trash_list_request(address: &str, root_path: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/root-trash?rootPath={root_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_global_shortcut_config_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/config/shortcuts HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_global_trash_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_global_trash_move_request(
    address: &str,
    absolute_paths: &[&Path],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let absolute_path_query = absolute_paths
        .iter()
        .map(|absolute_path| {
            format!(
                "absolutePath={}",
                percent_encode(&absolute_path.display().to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/global-trash/move?{absolute_path_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn send_global_trash_restore_request(address: &str, recycle_ids: &[&str], dry_run: bool) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let recycle_id_query = recycle_ids
        .iter()
        .map(|recycle_id| format!("recycleId={}", percent_encode(recycle_id)))
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/global-trash/restore?{recycle_id_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn json_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\")
}

fn read_listen_address(stdout: &mut impl BufRead) -> String {
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("runtime binary should print listen address");
    line.trim()
        .strip_prefix("listening\t")
        .expect("listen line should include address")
        .to_owned()
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-fixtures")
            .join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture root should be created");
        Self { root }
    }

    fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    fn write_bytes(&self, relative_path: &str, contents: &[u8]) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    fn assert_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        let actual = fs::read_to_string(path).expect("fixture file should exist");
        assert_eq!(actual, contents);
    }

    fn assert_missing(&self, relative_path: &str) {
        assert!(
            !self.root.join(relative_path).exists(),
            "{relative_path} should not exist",
        );
    }
}
