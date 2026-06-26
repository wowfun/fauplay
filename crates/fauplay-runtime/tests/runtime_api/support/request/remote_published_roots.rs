use std::io::{Read, Write};
use std::net::TcpStream;

pub(crate) fn send_remote_published_roots_sync_request(address: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/admin/remote-published-roots/sync-from-local-browser HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_shared_favorites_list_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/remote/shared-favorites HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_shared_favorite_upsert_request(address: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/remote/shared-favorites/upsert HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_shared_favorite_remove_request(address: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/remote/shared-favorites/remove HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}
