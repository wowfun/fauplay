use std::io::{Read, Write};
use std::net::TcpStream;

use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_reports_health() {
    let (address, server) = serve_runtime_once(FauplayRuntime::new());

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
