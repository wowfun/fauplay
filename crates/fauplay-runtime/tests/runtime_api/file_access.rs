use std::io::{Read, Write};
use std::net::TcpStream;

use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_returns_text_preview() {
    let fixture = Fixture::new("runtime_api_returns_text_preview");
    fixture.write_file("notes.txt", "hello runtime");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_text_preview_request(
        &address,
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

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_text_preview_request(
        &address,
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

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_text_preview_request(
        &address,
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

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response =
        send_file_content_request(&address, &fixture.root.display().to_string(), "diagram.svg");
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

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_file_content_request_with_range(
        &address,
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

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_file_metadata_request(
        &address,
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
    let (address, server) = serve_runtime_once(FauplayRuntime::new());

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
