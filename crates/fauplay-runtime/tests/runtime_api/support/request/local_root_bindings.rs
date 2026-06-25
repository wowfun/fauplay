use std::io::{Read, Write};
use std::net::TcpStream;

use super::super::encoding::percent_encode;

pub(crate) fn send_local_root_binding_upsert_request(
    address: &str,
    root_id: &str,
    root_path: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "PUT /v1/local-root-bindings?rootId={}&rootPath={} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        percent_encode(root_id),
        percent_encode(root_path)
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_local_root_bindings_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/local-root-bindings HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}
