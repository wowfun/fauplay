use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::super::encoding::json_path;

pub(crate) fn send_root_move_request(
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

pub(crate) fn send_root_move_batch_json_request(
    address: &str,
    root_path: &str,
    root_relative_paths: &[&str],
    dry_run: bool,
) -> String {
    let root_relative_paths = root_relative_paths
        .iter()
        .map(|path| format!("\"{path}\""))
        .collect::<Vec<_>>()
        .join(",");
    let body = format!(
        "{{\"rootPath\":\"{}\",\"rootRelativePaths\":[{root_relative_paths}],\"nameMask\":\"[P]-[C]-[N]\",\"findText\":\"\",\"replaceText\":\"\",\"searchMode\":\"plain\",\"regexFlags\":\"g\",\"counterStart\":3,\"counterStep\":1,\"counterPad\":2,\"dryRun\":{dry_run}}}",
        json_path(Path::new(root_path)),
    );
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/root-move/batch HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_root_trash_request(
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

pub(crate) fn send_root_trash_request_with_paths(
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

pub(crate) fn send_root_trash_list_request(address: &str, root_path: &str) -> String {
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
