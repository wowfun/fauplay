use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::super::encoding::{json_path, percent_encode};

pub(crate) fn send_duplicate_files_request(
    address: &str,
    root_path: &str,
    root_relative_paths: &[&str],
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let mut query = format!("rootPath={}", percent_encode(root_path));
    for root_relative_path in root_relative_paths {
        query.push_str("&rootRelativePath=");
        query.push_str(&percent_encode(root_relative_path));
    }
    write!(
        stream,
        "GET /v1/duplicate-files?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_duplicate_files_json_request(
    address: &str,
    root_path: &str,
    root_relative_paths: &[&str],
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let root_relative_paths_json = root_relative_paths
        .iter()
        .map(|path| format!("\"{}\"", path))
        .collect::<Vec<_>>()
        .join(",");
    let body = format!(
        "{{\"rootPath\":\"{}\",\"rootRelativePath\":[{root_relative_paths_json}]}}",
        json_path(Path::new(root_path)),
    );
    write!(
        stream,
        "POST /v1/duplicate-files HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
