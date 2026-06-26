use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::super::{json_path, percent_encode};

pub(crate) fn send_text_preview_request(
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

pub(crate) fn send_absolute_text_preview_request(
    address: &str,
    absolute_path: &str,
    size_limit_bytes: u64,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let body = format!(
        "{{\"absolutePath\":\"{}\",\"sizeLimitBytes\":{size_limit_bytes}}}",
        json_path(Path::new(absolute_path)),
    );
    write!(
        stream,
        "POST /v1/files/text-preview HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_file_content_request(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> Vec<u8> {
    send_file_content_request_with_headers(address, root_path, root_relative_path, "")
}

pub(crate) fn send_file_content_request_with_range(
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

pub(crate) fn send_file_content_request_with_headers(
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

pub(crate) fn send_absolute_file_content_request(address: &str, absolute_path: &str) -> Vec<u8> {
    send_absolute_file_binary_request(address, "/v1/files/content", absolute_path)
}

pub(crate) fn send_absolute_file_thumbnail_request(address: &str, absolute_path: &str) -> Vec<u8> {
    send_absolute_file_binary_request(address, "/v1/files/thumbnail", absolute_path)
}

fn send_absolute_file_binary_request(
    address: &str,
    endpoint_path: &str,
    absolute_path: &str,
) -> Vec<u8> {
    let absolute_path = percent_encode(absolute_path);
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET {endpoint_path}?absolutePath={absolute_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_file_metadata_request(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> String {
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
