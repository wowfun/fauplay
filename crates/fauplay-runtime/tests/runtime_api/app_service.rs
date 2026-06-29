use std::io::{Read, Write};
use std::net::TcpStream;

use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn app_service_preserves_runtime_api_routes() {
    let fixture = web_app_fixture("app_service_preserves_runtime_api_routes");
    let response = send_app_request_once(&fixture, "/v1/health");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "health response should be OK: {response}"
    );
    assert!(
        response.contains("\"runtime\":\"fauplay-runtime\""),
        "health response should come from Runtime API: {response}"
    );
}

#[test]
fn app_service_serves_index_for_root_and_spa_routes() {
    let fixture = web_app_fixture("app_service_serves_index_for_root_and_spa_routes");

    for target in ["/", "/workspace/photos"] {
        let response = send_app_request_once(&fixture, target);
        assert!(
            response.starts_with("HTTP/1.1 200 OK\r\n"),
            "{target} should return OK: {response}"
        );
        assert!(
            response.contains("Content-Type: text/html; charset=utf-8"),
            "{target} should return HTML: {response}"
        );
        assert!(
            response.contains("<div id=\"root\"></div>"),
            "{target} should return the Web App shell: {response}"
        );
    }
}

#[test]
fn app_service_serves_static_assets_with_content_type() {
    let fixture = web_app_fixture("app_service_serves_static_assets_with_content_type");
    fixture.write_file("dist/assets/app.js", "console.log('fauplay')\n");

    let response = send_app_request_once(&fixture, "/assets/app.js");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "asset response should be OK: {response}"
    );
    assert!(
        response.contains("Content-Type: text/javascript; charset=utf-8"),
        "asset response should include JavaScript content type: {response}"
    );
    assert!(
        response.ends_with("console.log('fauplay')\n"),
        "asset response should include file body: {response}"
    );
}

#[test]
fn app_service_returns_404_for_missing_static_assets() {
    let fixture = web_app_fixture("app_service_returns_404_for_missing_static_assets");

    let response = send_app_request_once(&fixture, "/assets/missing.js");

    assert!(
        response.starts_with("HTTP/1.1 404 Not Found\r\n"),
        "missing asset should return 404: {response}"
    );
}

#[test]
fn app_service_rejects_paths_outside_web_dist() {
    let fixture = web_app_fixture("app_service_rejects_paths_outside_web_dist");
    fixture.write_file("secret.txt", "do-not-serve");

    for target in [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/assets/%2e%2e/%2e%2e/secret.txt",
    ] {
        let response = send_app_request_once(&fixture, target);
        assert!(
            response.starts_with("HTTP/1.1 404 Not Found\r\n"),
            "{target} should return 404: {response}"
        );
        assert!(
            !response.contains("do-not-serve"),
            "{target} should not expose files outside dist: {response}"
        );
    }
}

fn web_app_fixture(name: &str) -> Fixture {
    let fixture = Fixture::new(name);
    fixture.write_file(
        "dist/index.html",
        "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    );
    fixture
}

fn send_app_request_once(fixture: &Fixture, target: &str) -> String {
    let (address, server) =
        serve_fauplay_app_once(FauplayRuntime::new(), fixture.root.join("dist"));

    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    server.join().expect("server thread should finish");
    response
}
