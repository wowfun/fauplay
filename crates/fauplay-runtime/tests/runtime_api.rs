use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

#[path = "runtime_api/global_trash.rs"]
mod global_trash;
#[path = "runtime_api/root_operations.rs"]
mod root_operations;
#[path = "runtime_api/support.rs"]
mod support;

use support::*;

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
fn runtime_api_queries_duplicate_files_inside_local_root() {
    let fixture = Fixture::new("runtime_api_queries_duplicate_files_inside_local_root");
    fixture.write_file("albums/current.jpg", "same image");
    fixture.write_file("albums/copy.jpg", "same image");
    fixture.write_file(".trash/current.jpg", "same image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_duplicate_files_request(
        &address.to_string(),
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

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_duplicate_files_json_request(
        &address.to_string(),
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
        response.contains("Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS\r\n"),
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
